-- v24: per-NAS authorization for device administration.
-- Existing radius_ops_groups become reusable Permission Profiles.  Users may
-- select multiple NAS Collections and choose a different profile for each.
CREATE TABLE IF NOT EXISTS radius_ops_collections (
  id uuid PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,name)
);
CREATE INDEX IF NOT EXISTS radius_ops_collections_company_idx ON radius_ops_collections(company_id);

CREATE TABLE IF NOT EXISTS radius_ops_collection_members (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES radius_ops_collections(id) ON DELETE CASCADE,
  nas_source inet NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,nas_source)
);
CREATE INDEX IF NOT EXISTS radius_ops_collection_members_source_idx ON radius_ops_collection_members USING gist(nas_source inet_ops);

CREATE TABLE IF NOT EXISTS radius_ops_access_rules (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES radius_ops_accounts(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES radius_ops_collections(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES radius_ops_groups(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,collection_id)
);
CREATE INDEX IF NOT EXISTS radius_ops_access_rules_account_idx ON radius_ops_access_rules(account_id);
CREATE INDEX IF NOT EXISTS radius_ops_access_rules_collection_idx ON radius_ops_access_rules(collection_id);
CREATE INDEX IF NOT EXISTS radius_ops_access_rules_profile_idx ON radius_ops_access_rules(profile_id);

-- Preserve v23 behaviour: every existing account/group pair initially has
-- company-wide access.  Operators can replace this generated collection with
-- narrower Branch/Hotspot/Main-Router collections from the UI.
INSERT INTO radius_ops_collections(id,company_id,name,description,enabled)
SELECT (
  substr(md5('ems-radius-all:'||c.id),1,8)||'-'||substr(md5('ems-radius-all:'||c.id),9,4)||'-'||
  substr(md5('ems-radius-all:'||c.id),13,4)||'-'||substr(md5('ems-radius-all:'||c.id),17,4)||'-'||
  substr(md5('ems-radius-all:'||c.id),21,12)
)::uuid,c.id,'All registered NAS','Migrated full-company NAS scope',true
FROM companies c
WHERE c.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM radius_ops_accounts a WHERE a.company_id=c.id AND a.group_id IS NOT NULL)
ON CONFLICT(company_id,name) DO NOTHING;

INSERT INTO radius_ops_collection_members(id,collection_id,nas_source)
SELECT (
  substr(md5('ems-radius-all-member:'||col.id::text),1,8)||'-'||substr(md5('ems-radius-all-member:'||col.id::text),9,4)||'-'||
  substr(md5('ems-radius-all-member:'||col.id::text),13,4)||'-'||substr(md5('ems-radius-all-member:'||col.id::text),17,4)||'-'||
  substr(md5('ems-radius-all-member:'||col.id::text),21,12)
)::uuid,col.id,'0.0.0.0/0'::inet
FROM radius_ops_collections col
WHERE col.name='All registered NAS'
ON CONFLICT(collection_id,nas_source) DO NOTHING;

INSERT INTO radius_ops_access_rules(id,account_id,collection_id,profile_id,enabled)
SELECT (
  substr(md5('ems-radius-rule:'||a.id::text),1,8)||'-'||substr(md5('ems-radius-rule:'||a.id::text),9,4)||'-'||
  substr(md5('ems-radius-rule:'||a.id::text),13,4)||'-'||substr(md5('ems-radius-rule:'||a.id::text),17,4)||'-'||
  substr(md5('ems-radius-rule:'||a.id::text),21,12)
)::uuid,a.id,col.id,a.group_id,true
FROM radius_ops_accounts a
JOIN radius_ops_collections col ON col.company_id=a.company_id AND col.name='All registered NAS'
WHERE a.group_id IS NOT NULL
ON CONFLICT(account_id,collection_id) DO NOTHING;

-- Managed device-admin users no longer use static radusergroup replies. Their
-- Cisco/MikroTik reply attributes are selected from the matching NAS scope.
DELETE FROM radusergroup WHERE username IN (SELECT username FROM radius_ops_accounts);

CREATE OR REPLACE FUNCTION radius_ops_resolve_access(identity text,source_ip inet)
RETURNS TABLE(
  profile_id uuid,
  cisco_privilege smallint,
  mikrotik_group varchar(32),
  collection_id uuid,
  collection_name varchar(120)
) LANGUAGE sql STABLE AS $$
 WITH matched_nas AS (
   SELECT d.id,d.company_id,d.nas_ip
   FROM radius_ops_devices d
   JOIN companies c ON c.id=d.company_id AND c.deleted_at IS NULL
   WHERE d.enabled AND source_ip <<= d.nas_ip
   ORDER BY masklen(d.nas_ip) DESC,d.id
   LIMIT 1
 ), candidates AS (
   SELECT g.id AS profile_id,g.cisco_privilege,g.mikrotik_group,
          col.id AS collection_id,col.name AS collection_name,
          masklen(m.nas_source) AS prefix_len
   FROM matched_nas n
   JOIN radius_ops_accounts a
     ON a.company_id=n.company_id AND a.username=identity AND a.enabled
   JOIN radius_ops_access_rules ar ON ar.account_id=a.id AND ar.enabled
   JOIN radius_ops_collections col
     ON col.id=ar.collection_id AND col.company_id=n.company_id AND col.enabled
   JOIN radius_ops_collection_members m
     ON m.collection_id=col.id AND source_ip <<= m.nas_source
   JOIN radius_ops_groups g
     ON g.id=ar.profile_id AND g.company_id=n.company_id AND g.enabled
 ), winners AS (
   SELECT * FROM candidates
   WHERE prefix_len=(SELECT max(prefix_len) FROM candidates)
 )
 SELECT w.profile_id,w.cisco_privilege,w.mikrotik_group,w.collection_id,w.collection_name
 FROM winners w
 WHERE (SELECT count(DISTINCT profile_id) FROM winners)=1
 ORDER BY w.collection_name,w.collection_id
 LIMIT 1
$$;

CREATE OR REPLACE FUNCTION radius_ops_identity_allowed(identity text,source_ip inet)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH matched_nas AS (
   SELECT d.company_id
   FROM radius_ops_devices d
   JOIN companies c ON c.id=d.company_id AND c.deleted_at IS NULL
   WHERE d.enabled AND source_ip <<= d.nas_ip
   ORDER BY masklen(d.nas_ip) DESC,d.id
   LIMIT 1
 )
 SELECT EXISTS(SELECT 1 FROM radius_ops_resolve_access(identity,source_ip))
 OR EXISTS(
   SELECT 1
   FROM matched_nas n
   JOIN radius_ops_mac_aliases al ON al.alias=identity
   JOIN radius_ops_macs m ON m.id=al.mac_id
   WHERE m.company_id=n.company_id AND m.enabled
 )
$$;

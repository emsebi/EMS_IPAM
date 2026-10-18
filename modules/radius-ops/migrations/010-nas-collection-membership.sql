-- v28: NAS Collections are named groups of registered NAS objects.
-- Legacy CIDR members remain in radius_ops_collection_members for rollback/
-- audit compatibility, but authorization no longer evaluates those raw scopes.
CREATE TABLE IF NOT EXISTS radius_ops_collection_devices (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES radius_ops_collections(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES radius_ops_devices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,device_id)
);
CREATE INDEX IF NOT EXISTS radius_ops_collection_devices_collection_idx
  ON radius_ops_collection_devices(collection_id);
CREATE INDEX IF NOT EXISTS radius_ops_collection_devices_device_idx
  ON radius_ops_collection_devices(device_id);

-- Preserve existing intent: every registered NAS whose source range overlaps a
-- legacy collection scope becomes a member of that named collection. Thus an
-- old 0.0.0.0/0 collection becomes a named group containing all current NASes.
INSERT INTO radius_ops_collection_devices(id,collection_id,device_id)
SELECT (
  substr(md5('ems-radius-collection-device:'||m.collection_id::text||':'||d.id::text),1,8)||'-'||
  substr(md5('ems-radius-collection-device:'||m.collection_id::text||':'||d.id::text),9,4)||'-'||
  substr(md5('ems-radius-collection-device:'||m.collection_id::text||':'||d.id::text),13,4)||'-'||
  substr(md5('ems-radius-collection-device:'||m.collection_id::text||':'||d.id::text),17,4)||'-'||
  substr(md5('ems-radius-collection-device:'||m.collection_id::text||':'||d.id::text),21,12)
)::uuid,m.collection_id,d.id
FROM radius_ops_collection_members m
JOIN radius_ops_collections col ON col.id=m.collection_id
JOIN radius_ops_devices d
  ON d.company_id=col.company_id
 AND d.nas_ip && m.nas_source
ON CONFLICT(collection_id,device_id) DO NOTHING;

CREATE OR REPLACE FUNCTION radius_ops_resolve_access(identity text,source_ip inet)
RETURNS TABLE(
  profile_id uuid,
  cisco_privilege smallint,
  mikrotik_group varchar(32),
  collection_id uuid,
  collection_name varchar(120)
) LANGUAGE sql STABLE AS $$
 WITH matched_nas AS (
   SELECT n.device_id AS id,n.company_id
   FROM radius_ops_resolve_nas(source_ip) n
   WHERE n.active
 ), candidates AS (
   SELECT g.id AS profile_id,g.cisco_privilege,g.mikrotik_group,
          col.id AS collection_id,col.name AS collection_name
   FROM matched_nas n
   JOIN radius_ops_accounts a
     ON a.company_id=n.company_id AND a.username=identity AND a.enabled
   JOIN radius_ops_collection_devices cd ON cd.device_id=n.id
   JOIN radius_ops_collections col
     ON col.id=cd.collection_id AND col.company_id=n.company_id AND col.enabled
   JOIN radius_ops_access_rules ar
     ON ar.account_id=a.id AND ar.collection_id=col.id AND ar.enabled
   JOIN radius_ops_groups g
     ON g.id=ar.profile_id AND g.company_id=n.company_id AND g.enabled
 ), winners AS (
   SELECT * FROM candidates
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
   SELECT n.company_id
   FROM radius_ops_resolve_nas(source_ip) n
   WHERE n.active
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

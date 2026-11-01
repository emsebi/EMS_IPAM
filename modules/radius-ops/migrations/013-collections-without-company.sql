-- NAS Collections are the explicit device-access boundary. Preserve legacy IDs,
-- credentials and assignments; Company metadata remains only for compatibility.
-- Refuse malformed legacy links which old Company equality had kept inactive.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM radius_ops_access_rules ar
  JOIN radius_ops_accounts a ON a.id=ar.account_id
  JOIN radius_ops_collections col ON col.id=ar.collection_id
  JOIN radius_ops_groups g ON g.id=ar.profile_id
  JOIN radius_ops_collection_devices cd ON cd.collection_id=col.id
  JOIN radius_ops_devices d ON d.id=cd.device_id
  WHERE a.company_id IS DISTINCT FROM d.company_id
     OR col.company_id IS DISTINCT FROM d.company_id
     OR g.company_id IS DISTINCT FROM d.company_id
 ) THEN RAISE EXCEPTION 'Inconsistent legacy RADIUS access links; review before upgrading';
 END IF;
END $$;

ALTER TABLE radius_ops_devices ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE radius_ops_accounts ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE radius_ops_collections ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE radius_ops_groups ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE radius_ops_secret_profiles ALTER COLUMN company_id DROP NOT NULL;
CREATE UNIQUE INDEX radius_ops_collections_standalone_name_idx ON radius_ops_collections(name) WHERE company_id IS NULL;
CREATE UNIQUE INDEX radius_ops_groups_standalone_name_idx ON radius_ops_groups(name) WHERE company_id IS NULL;
CREATE UNIQUE INDEX radius_ops_secret_profiles_standalone_name_idx ON radius_ops_secret_profiles(name) WHERE company_id IS NULL;

CREATE OR REPLACE FUNCTION radius_ops_resolve_nas(source_ip inet)
RETURNS TABLE(
  device_id uuid,
  company_id text,
  nas_ip inet,
  active boolean
) LANGUAGE sql STABLE AS $$
 SELECT d.id,d.company_id,d.nas_ip,
        (
          d.enabled
          AND (d.company_id IS NULL OR (c.id IS NOT NULL AND c.deleted_at IS NULL))
          AND sp.id IS NOT NULL AND sp.enabled
          AND (sp.company_id IS NULL OR (sc.id IS NOT NULL AND sc.deleted_at IS NULL))
          AND (
            d.host_id IS NULL OR
            (h.id IS NOT NULL AND h.deleted_at IS NULL
             AND s.id IS NOT NULL AND s.deleted_at IS NULL
             AND s.company_id=d.company_id)
          )
        ) AS active
 FROM radius_ops_devices d
 LEFT JOIN companies c ON c.id=d.company_id
 LEFT JOIN radius_ops_secret_profiles sp ON sp.id=d.secret_profile_id
 LEFT JOIN companies sc ON sc.id=sp.company_id
 LEFT JOIN hosts h ON h.id=d.host_id
 LEFT JOIN address_spaces s ON s.id=h.space_id
 WHERE source_ip <<= d.nas_ip
 ORDER BY masklen(d.nas_ip) DESC,d.id
 LIMIT 1
$$;


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
     ON a.username=identity AND a.enabled
   JOIN radius_ops_collection_devices cd ON cd.device_id=n.id
   JOIN radius_ops_collections col
     ON col.id=cd.collection_id AND col.enabled
   JOIN radius_ops_access_rules ar
     ON ar.account_id=a.id AND ar.collection_id=col.id AND ar.enabled
   JOIN radius_ops_groups g
     ON g.id=ar.profile_id AND g.enabled
   LEFT JOIN companies ac ON ac.id=a.company_id
   LEFT JOIN companies cc ON cc.id=col.company_id
   LEFT JOIN companies gc ON gc.id=g.company_id
   WHERE (a.company_id IS NULL OR (ac.id IS NOT NULL AND ac.deleted_at IS NULL))
     AND (col.company_id IS NULL OR (cc.id IS NOT NULL AND cc.deleted_at IS NULL))
     AND (g.company_id IS NULL OR (gc.id IS NOT NULL AND gc.deleted_at IS NULL))
 ), winners AS (
   SELECT * FROM candidates
 )
 SELECT w.profile_id,w.cisco_privilege,w.mikrotik_group,w.collection_id,w.collection_name
 FROM winners w
 WHERE (SELECT count(DISTINCT profile_id) FROM winners)=1
 ORDER BY w.collection_name,w.collection_id
 LIMIT 1
$$;

-- MAB/NAC identity policy is intentionally unchanged.

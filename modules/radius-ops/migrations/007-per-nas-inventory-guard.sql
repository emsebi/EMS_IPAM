-- v25: restore Inventory fail-closed guards to the per-NAS resolver.
-- A linked NAS is usable only while its Host, Address Space and Company remain
-- active and tenant-consistent. Direct NAS entries (host_id IS NULL) remain
-- valid without an IPAM host.
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
   LEFT JOIN hosts h ON h.id=d.host_id
   LEFT JOIN address_spaces s ON s.id=h.space_id
   WHERE d.enabled
     AND source_ip <<= d.nas_ip
     AND (
       d.host_id IS NULL OR
       (h.id IS NOT NULL AND h.deleted_at IS NULL
        AND s.id IS NOT NULL AND s.deleted_at IS NULL
        AND s.company_id=d.company_id)
     )
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
   LEFT JOIN hosts h ON h.id=d.host_id
   LEFT JOIN address_spaces s ON s.id=h.space_id
   WHERE d.enabled
     AND source_ip <<= d.nas_ip
     AND (
       d.host_id IS NULL OR
       (h.id IS NOT NULL AND h.deleted_at IS NULL
        AND s.id IS NOT NULL AND s.deleted_at IS NULL
        AND s.company_id=d.company_id)
     )
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

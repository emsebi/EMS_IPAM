-- Fail closed when an IPAM host, address space or company is archived or moved.
-- Preserve migrations 001-003 and existing credentials; no destructive DDL.
CREATE OR REPLACE FUNCTION radius_ops_identity_allowed(identity text,source_ip inet)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
   SELECT 1 FROM radius_ops_devices d
   JOIN hosts h ON h.id=d.host_id AND h.deleted_at IS NULL
   JOIN address_spaces s ON s.id=h.space_id AND s.deleted_at IS NULL
   JOIN companies c ON c.id=s.company_id AND c.deleted_at IS NULL
   WHERE d.enabled AND d.nas_ip=source_ip AND d.company_id=s.company_id
     AND (
       EXISTS(SELECT 1 FROM radius_ops_accounts a
              WHERE a.company_id=d.company_id AND a.username=identity AND a.enabled)
       OR EXISTS(SELECT 1 FROM radius_ops_mac_aliases al
                 JOIN radius_ops_macs m ON m.id=al.mac_id
                 WHERE al.alias=identity AND m.company_id=d.company_id AND m.enabled)
     )
 );
$$;

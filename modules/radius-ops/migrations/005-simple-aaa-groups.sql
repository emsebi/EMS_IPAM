-- v23: Simple operator-facing AAA model.
-- NAS clients may be registered directly by IPv4/CIDR, groups hold authorization,
-- and users are assigned to one group. Existing v22 data remains valid.

ALTER TABLE radius_ops_devices ALTER COLUMN host_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS radius_ops_groups (
  id uuid PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  cisco_privilege smallint NOT NULL DEFAULT 1 CHECK (cisco_privilege BETWEEN 0 AND 15),
  mikrotik_group varchar(32) NOT NULL DEFAULT 'read',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,name)
);
CREATE INDEX IF NOT EXISTS radius_ops_groups_company_idx ON radius_ops_groups(company_id);

ALTER TABLE radius_ops_accounts
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES radius_ops_groups(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS radius_ops_accounts_group_idx ON radius_ops_accounts(group_id);

-- Direct NAS clients are allowed without an IPAM host. If a host is linked,
-- it must still be active and belong to the same company. IPv4 source matching
-- accepts an exact host or a registered CIDR (source_ip <<= d.nas_ip).
CREATE OR REPLACE FUNCTION radius_ops_identity_allowed(identity text,source_ip inet)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
   SELECT 1
     FROM radius_ops_devices d
     JOIN companies c ON c.id=d.company_id AND c.deleted_at IS NULL
     LEFT JOIN hosts h ON h.id=d.host_id
     LEFT JOIN address_spaces s ON s.id=h.space_id
    WHERE d.enabled
      AND source_ip <<= d.nas_ip
      AND (
        d.host_id IS NULL OR
        (h.id IS NOT NULL AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND s.company_id=d.company_id)
      )
      AND (
        EXISTS(SELECT 1 FROM radius_ops_accounts a
               WHERE a.company_id=d.company_id AND a.username=identity AND a.enabled)
        OR EXISTS(SELECT 1 FROM radius_ops_mac_aliases al
                  JOIN radius_ops_macs m ON m.id=al.mac_id
                  WHERE al.alias=identity AND m.company_id=d.company_id AND m.enabled)
      )
 );
$$;

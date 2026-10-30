CREATE TABLE IF NOT EXISTS network_map_snapshots (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL, source text NOT NULL DEFAULT 'manual', snapshot jsonb NOT NULL
);
ALTER TABLE network_map_snapshots ADD COLUMN IF NOT EXISTS company_id text REFERENCES companies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS network_map_snapshot_company ON network_map_snapshots(company_id,created_at DESC);
CREATE TABLE IF NOT EXISTS network_map_settings (
  company_id text PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  settings jsonb NOT NULL DEFAULT '{}', password_ciphertext text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS network_map_state (
  company_id text PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  topology jsonb NOT NULL DEFAULT '{"nodes":[],"links":[]}',
  layout jsonb NOT NULL DEFAULT '{"positions":{},"background":""}'
);
CREATE TABLE IF NOT EXISTS network_map_host_keys (
  company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  address text NOT NULL, port int NOT NULL, fingerprint text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,address,port)
);
-- Inventory only. Adding a record NEVER enables MAB or changes RADIUS policy.
CREATE TABLE IF NOT EXISTS network_mac_registry (
  id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  mac macaddr NOT NULL, name text NOT NULL CHECK(length(name)>0),
  device_type_id text REFERENCES device_types(id) ON DELETE SET NULL,
  owner text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,mac)
);

CREATE TABLE IF NOT EXISTS network_maps (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  deleted_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS network_map_snapshots (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES network_maps(id) ON DELETE CASCADE,
  version integer NOT NULL,
  seed_ip text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('ssh','telnet')),
  topology jsonb NOT NULL,
  device_count integer NOT NULL DEFAULT 0,
  link_count integer NOT NULL DEFAULT 0,
  scan_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  deleted_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(map_id, version)
);

CREATE TABLE IF NOT EXISTS network_config_backups (
  id text PRIMARY KEY,
  map_id text REFERENCES network_maps(id) ON DELETE SET NULL,
  snapshot_id text REFERENCES network_map_snapshots(id) ON DELETE SET NULL,
  device_key text NOT NULL,
  hostname text NOT NULL DEFAULT '',
  ip text NOT NULL,
  platform text NOT NULL DEFAULT '',
  os_version text NOT NULL DEFAULT '',
  config_text text NOT NULL,
  config_hash text NOT NULL,
  redaction_count integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  deleted_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS network_maps_company_idx ON network_maps(company_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS network_maps_deleted_idx ON network_maps(deleted_at);
CREATE INDEX IF NOT EXISTS network_snapshots_map_idx ON network_map_snapshots(map_id,version DESC);
CREATE INDEX IF NOT EXISTS network_backups_device_idx ON network_config_backups(device_key,created_at DESC);
CREATE INDEX IF NOT EXISTS network_backups_map_idx ON network_config_backups(map_id,created_at DESC);

CREATE TABLE IF NOT EXISTS network_map_manual_devices (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES network_maps(id) ON DELETE CASCADE,
  ip text NOT NULL,
  hostname text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(map_id,ip)
);
CREATE INDEX IF NOT EXISTS network_manual_map_idx ON network_map_manual_devices(map_id,ip);

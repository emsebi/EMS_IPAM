CREATE TABLE IF NOT EXISTS radius_networks (
  id text PRIMARY KEY,
  name text NOT NULL,
  cidr text NOT NULL UNIQUE,
  vendor text NOT NULL DEFAULT 'any',
  secret_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radius_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  password_ciphertext text NOT NULL,
  account_type text NOT NULL DEFAULT 'human' CHECK (account_type IN ('human','system')),
  mikrotik_access text NOT NULL DEFAULT 'none' CHECK (mikrotik_access IN ('none','read','write','full')),
  cisco_privilege integer NOT NULL DEFAULT 0 CHECK (cisco_privilege BETWEEN 0 AND 15),
  nexus_role text NOT NULL DEFAULT 'none' CHECK (nexus_role IN ('none','network-operator','network-admin')),
  enabled boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radius_mac_clients (
  id text PRIMARY KEY,
  mac text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  device_type text NOT NULL DEFAULT 'other',
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  access_mode text NOT NULL DEFAULT 'allow' CHECK (access_mode IN ('allow','allow_vlan','block')),
  vlan integer CHECK (vlan BETWEEN 1 AND 4094),
  enabled boolean NOT NULL DEFAULT true,
  last_switch_ip text NOT NULL DEFAULT '',
  last_switch_name text NOT NULL DEFAULT '',
  last_port text NOT NULL DEFAULT '',
  last_vlan integer CHECK (last_vlan BETWEEN 1 AND 4094),
  last_seen_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radius_mac_history (
  id bigserial PRIMARY KEY,
  mac_id text NOT NULL REFERENCES radius_mac_clients(id) ON DELETE CASCADE,
  switch_ip text NOT NULL DEFAULT '',
  switch_name text NOT NULL DEFAULT '',
  port text NOT NULL DEFAULT '',
  vlan integer,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radius_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  unknown_mac_policy text NOT NULL DEFAULT 'reject' CHECK (unknown_mac_policy IN ('reject','quarantine','allow')),
  quarantine_vlan integer CHECK (quarantine_vlan BETWEEN 1 AND 4094),
  radius_server_ip text NOT NULL DEFAULT '',
  keep_mac_history integer NOT NULL DEFAULT 5 CHECK (keep_mac_history BETWEEN 0 AND 20),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO radius_settings(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS radius_auth_events (
  id bigserial PRIMARY KEY,
  username text NOT NULL DEFAULT '',
  calling_station_id text NOT NULL DEFAULT '',
  nas_ip text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS radius_mac_company_idx ON radius_mac_clients(company_id,name);
CREATE INDEX IF NOT EXISTS radius_mac_last_seen_idx ON radius_mac_clients(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS radius_mac_history_idx ON radius_mac_history(mac_id,seen_at DESC);
CREATE INDEX IF NOT EXISTS radius_auth_events_idx ON radius_auth_events(created_at DESC);

ALTER TABLE radius_mac_clients ADD COLUMN IF NOT EXISTS last_vlan integer;

CREATE TABLE IF NOT EXISTS radius_nas_profiles (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  name text NOT NULL,
  vendor text NOT NULL CHECK (vendor IN ('cisco','mikrotik','other')),
  nas_ip text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  auth_port integer NOT NULL DEFAULT 1812 CHECK (auth_port BETWEEN 1 AND 65535),
  acct_port integer NOT NULL DEFAULT 1813 CHECK (acct_port BETWEEN 1 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id),
  UNIQUE(nas_ip),
  CHECK (auth_port <> acct_port),
  CHECK (jsonb_typeof(services) = 'array')
);

CREATE INDEX IF NOT EXISTS radius_nas_company_idx ON radius_nas_profiles(company_id);

CREATE TABLE IF NOT EXISTS radius_admin_profiles (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  cisco_privilege integer NOT NULL DEFAULT 1 CHECK (cisco_privilege BETWEEN 0 AND 15),
  mikrotik_group text NOT NULL DEFAULT 'read',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radius_mab_policies (
  id text PRIMARY KEY,
  nas_profile_id text NOT NULL UNIQUE REFERENCES radius_nas_profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  known_mode text NOT NULL DEFAULT 'reject' CHECK (known_mode IN ('reject','accept-static','accept-dynamic')),
  known_vlan integer CHECK (known_vlan BETWEEN 1 AND 4094),
  unknown_mode text NOT NULL DEFAULT 'reject' CHECK (unknown_mode IN ('reject','guest-vlan')),
  guest_vlan integer CHECK (guest_vlan BETWEEN 1 AND 4094),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (known_mode <> 'accept-dynamic' OR known_vlan IS NOT NULL),
  CHECK (unknown_mode <> 'guest-vlan' OR guest_vlan IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS radius_mab_nas_idx ON radius_mab_policies(nas_profile_id);

-- Deliberately no shared-secret, password, token, or credential column.
-- Operational credentials require a separate secure-store design.

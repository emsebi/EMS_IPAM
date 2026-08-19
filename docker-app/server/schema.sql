CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS address_spaces (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  cidr text NOT NULL,
  color text NOT NULL DEFAULT '#3157d5',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, cidr)
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_company_access (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, company_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prefixes (
  id text PRIMARY KEY,
  space_id text NOT NULL REFERENCES address_spaces(id) ON DELETE CASCADE,
  cidr text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT '',
  vlan text NOT NULL DEFAULT '',
  gateway text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#3157d5',
  description text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, cidr)
);

CREATE TABLE IF NOT EXISTS hosts (
  id text PRIMARY KEY,
  space_id text NOT NULL REFERENCES address_spaces(id) ON DELETE CASCADE,
  ip text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  type text NOT NULL DEFAULT '',
  os text NOT NULL DEFAULT '',
  mac text NOT NULL DEFAULT '',
  vlan text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  secret_ref text NOT NULL DEFAULT '',
  secret_ciphertext text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  ports jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, ip)
);

CREATE TABLE IF NOT EXISTS ping_results (
  space_id text NOT NULL REFERENCES address_spaces(id) ON DELETE CASCADE,
  ip text NOT NULL,
  online boolean NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  PRIMARY KEY(space_id, ip)
);

CREATE TABLE IF NOT EXISTS tool_defaults (
  tool text PRIMARY KEY,
  label text NOT NULL,
  default_port integer NOT NULL CHECK (default_port BETWEEN 0 AND 65535),
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  company_id text,
  space_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prefixes_space_idx ON prefixes(space_id);
CREATE INDEX IF NOT EXISTS hosts_space_idx ON hosts(space_id);
CREATE INDEX IF NOT EXISTS hosts_ip_idx ON hosts(ip);
CREATE INDEX IF NOT EXISTS audit_space_created_idx ON audit_log(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

ALTER TABLE hosts ADD COLUMN IF NOT EXISTS secret_ciphertext text NOT NULL DEFAULT '';

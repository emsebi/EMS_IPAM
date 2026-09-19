CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','support','helpdesk','viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#1677ff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS sites_company_idx ON sites(company_id);

CREATE TABLE IF NOT EXISTS personnel (
  id text PRIMARY KEY,
  employee_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  site_id text REFERENCES sites(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personnel_name_idx ON personnel(lower(full_name));

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  name text NOT NULL,
  management_ip text NOT NULL DEFAULT '',
  mac text NOT NULL DEFAULT '',
  vendor text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  serial text NOT NULL DEFAULT '',
  os_version text NOT NULL DEFAULT '',
  device_type text NOT NULL DEFAULT '',
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  site_id text REFERENCES sites(id) ON DELETE SET NULL,
  owner_personnel_id text REFERENCES personnel(id) ON DELETE SET NULL,
  owner_text text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  asset_tag text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'manual',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_name_idx ON devices(lower(name));
CREATE INDEX IF NOT EXISTS devices_ip_idx ON devices(management_ip);
CREATE INDEX IF NOT EXISTS devices_mac_idx ON devices(mac);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS module_migrations (
  module_id text NOT NULL,
  migration_name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(module_id, migration_name)
);

CREATE TABLE IF NOT EXISTS module_state (
  module_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  installed_version text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  source_ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS backup_history (
  id text PRIMARY KEY,
  filename text NOT NULL,
  backup_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'created',
  size_bytes bigint NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key, value) VALUES
  ('general', '{"appName":"EMS_IPAM","language":"fa","timezone":"Asia/Tehran"}'::jsonb),
  ('appearance', '{"theme":"light","sidebar":"dark","density":"comfortable"}'::jsonb),
  ('backup', '{"enabled":true,"schedule":"daily","hour":2,"retentionDays":30}'::jsonb),
  ('macHistory', '{"retentionDays":7}'::jsonb)
ON CONFLICT(key) DO NOTHING;

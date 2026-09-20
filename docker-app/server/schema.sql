CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id text REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'company';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_name text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

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

ALTER TABLE address_spaces ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

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


-- Base v1.1 roles: admin changes core/IPAM settings; support/helpdesk/viewer are read-only here.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid, conname FROM pg_constraint WHERE conrelid='users'::regclass AND contype='c' LOOP
    IF pg_get_constraintdef(r.oid) ILIKE '%role%' THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname); END IF;
  END LOOP;
END $$;
UPDATE users SET role='support' WHERE role='editor';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','support','helpdesk','viewer'));

CREATE TABLE IF NOT EXISTS personnel (
  id text PRIMARY KEY,
  employee_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  mobile text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personnel_search_idx ON personnel(employee_code, full_name);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE address_spaces ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS company_contacts (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  mobile text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_connections (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  ip text NOT NULL,
  provider text NOT NULL DEFAULT '',
  link_role text NOT NULL DEFAULT 'primary',
  device_name text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  connection_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_company_access (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, company_id)
);

CREATE TABLE IF NOT EXISTS user_space_access (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES address_spaces(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, space_id)
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

ALTER TABLE prefixes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE prefixes ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(id) ON DELETE SET NULL;

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

ALTER TABLE hosts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(id) ON DELETE SET NULL;

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
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS vendor text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS serial text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS firmware text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS radio_mode text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS ssid text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS signal text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS radio_parent_host_id text REFERENCES hosts(id) ON DELETE SET NULL;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS connection_methods jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_driver text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_port integer NOT NULL DEFAULT 8728;
ALTER TABLE hosts ALTER COLUMN monitor_port SET DEFAULT 8728;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_username text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_secret_ciphertext text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_ca_pem text NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_interval integer NOT NULL DEFAULT 60;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_checked_at timestamptz;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_last_ok_at timestamptz;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_failures integer NOT NULL DEFAULT 0;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS monitor_error text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key,value) VALUES
  ('backup', '{"enabled":true,"intervalDays":1,"hour":2,"retentionDays":30,"lastRunAt":null}'::jsonb)
ON CONFLICT(key) DO NOTHING;

-- سیاست امنیتی نسخه 0.6: رمز تجهیزات و پایش خودکار هرگز نگهداری نمی‌شود.
UPDATE hosts SET
  secret_ciphertext='',
  monitor_secret_ciphertext='',
  monitor_enabled=false,
  monitor_driver='',
  monitor_username='',
  monitor_ca_pem='',
  monitor_state='{}'::jsonb,
  monitor_checked_at=NULL,
  monitor_last_ok_at=NULL,
  monitor_failures=0,
  monitor_error='';
DELETE FROM app_settings WHERE key='monitoring';

CREATE TABLE IF NOT EXISTS device_ports (
  id text PRIMARY KEY,
  host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  port_type text NOT NULL DEFAULT 'ethernet',
  speed text NOT NULL DEFAULT '',
  vlan_mode text NOT NULL DEFAULT '',
  vlan text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(host_id, name)
);

CREATE TABLE IF NOT EXISTS topology_maps (
  id text PRIMARY KEY,
  company_id text REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topology_nodes (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES topology_maps(id) ON DELETE CASCADE,
  host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  x integer NOT NULL DEFAULT 80,
  y integer NOT NULL DEFAULT 80,
  width integer NOT NULL DEFAULT 170,
  height integer NOT NULL DEFAULT 76,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(map_id, host_id)
);

CREATE TABLE IF NOT EXISTS topology_links (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES topology_maps(id) ON DELETE CASCADE,
  from_node_id text NOT NULL REFERENCES topology_nodes(id) ON DELETE CASCADE,
  to_node_id text NOT NULL REFERENCES topology_nodes(id) ON DELETE CASCADE,
  from_port_id text REFERENCES device_ports(id) ON DELETE SET NULL,
  to_port_id text REFERENCES device_ports(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  medium text NOT NULL DEFAULT 'ethernet',
  speed text NOT NULL DEFAULT '',
  vlan text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#64748b',
  status text NOT NULL DEFAULT 'unknown',
  discovered_by text NOT NULL DEFAULT 'manual',
  confirmed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id)
);

CREATE INDEX IF NOT EXISTS user_space_access_user_idx ON user_space_access(user_id);
CREATE INDEX IF NOT EXISTS hosts_radio_parent_idx ON hosts(radio_parent_host_id);
CREATE INDEX IF NOT EXISTS device_ports_host_idx ON device_ports(host_id);
CREATE INDEX IF NOT EXISTS topology_maps_company_idx ON topology_maps(company_id);
CREATE INDEX IF NOT EXISTS topology_nodes_map_idx ON topology_nodes(map_id);
CREATE INDEX IF NOT EXISTS topology_links_map_idx ON topology_links(map_id);
CREATE INDEX IF NOT EXISTS companies_parent_idx ON companies(parent_company_id);
CREATE INDEX IF NOT EXISTS companies_deleted_idx ON companies(deleted_at);
CREATE INDEX IF NOT EXISTS company_contacts_company_idx ON company_contacts(company_id);
CREATE INDEX IF NOT EXISTS company_connections_company_idx ON company_connections(company_id);
CREATE INDEX IF NOT EXISTS address_spaces_deleted_idx ON address_spaces(deleted_at);
CREATE INDEX IF NOT EXISTS prefixes_deleted_idx ON prefixes(deleted_at);
CREATE INDEX IF NOT EXISTS hosts_deleted_idx ON hosts(deleted_at);
CREATE INDEX IF NOT EXISTS hosts_monitor_idx ON hosts(monitor_enabled,monitor_checked_at);

-- Base v1.2: extensible inventory metadata without schema changes for every new field.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Base v1.3 module-level access. The same table is used by present and future modules.
CREATE TABLE IF NOT EXISTS user_module_access (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,module_id)
);
CREATE INDEX IF NOT EXISTS user_module_access_module_idx ON user_module_access(module_id,user_id);
-- Preserve access for users created before module permissions existed.
INSERT INTO user_module_access(user_id,module_id)
SELECT id,'ipam' FROM users WHERE role <> 'admin'
ON CONFLICT DO NOTHING;
INSERT INTO user_module_access(user_id,module_id)
SELECT id,'inventory' FROM users WHERE role <> 'admin'
ON CONFLICT DO NOTHING;

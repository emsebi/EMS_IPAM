-- Additive module schema. Do not alter core schema.sql.
CREATE TABLE IF NOT EXISTS radius_access_devices (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  network cidr NOT NULL,
  vendor varchar(20) NOT NULL CHECK(vendor IN ('cisco','mikrotik')),
  secret_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radius_access_devices_network_uniq UNIQUE(network)
);
CREATE TABLE IF NOT EXISTS radius_profiles (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  cisco_privilege smallint NOT NULL DEFAULT 1 CHECK(cisco_privilege BETWEEN 0 AND 15),
  mikrotik_group varchar(80) NOT NULL DEFAULT 'read',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS radius_engineers (
  id uuid PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  profile_id uuid NOT NULL REFERENCES radius_profiles(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS radius_auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  username varchar(100),
  nas_ip inet,
  event_type varchar(32) NOT NULL CHECK(event_type IN ('accept','reject','accounting_start','accounting_stop','accounting_interim')),
  session_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS radius_auth_events_time_idx ON radius_auth_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS radius_auth_events_username_idx ON radius_auth_events(username,occurred_at DESC);

-- Draft NAC policy objects; no change to FreeRADIUS radcheck/radreply, core or live authorization.
-- NAS and credentials remain owned by radius-ops; validated at the API boundary.
-- No cross-module FK: this module migrates alphabetically before radius-ops on fresh installs.
CREATE TABLE nac_profiles (
  id uuid PRIMARY KEY, name varchar(120) NOT NULL UNIQUE,
  description varchar(500) NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT false,
  known_mode text NOT NULL CHECK(known_mode IN ('accept-static','accept-vlan','reject')),
  known_vlan smallint CHECK(known_vlan BETWEEN 1 AND 4094),
  unknown_mode text NOT NULL CHECK(unknown_mode IN ('reject','guest-vlan')),
  guest_vlan smallint CHECK(guest_vlan BETWEEN 1 AND 4094),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nac_known_vlan_check CHECK((known_mode='accept-vlan')=(known_vlan IS NOT NULL)),
  CONSTRAINT nac_guest_vlan_check CHECK((unknown_mode='guest-vlan')=(guest_vlan IS NOT NULL)),
  CONSTRAINT nac_distinct_vlan_check CHECK(known_vlan IS NULL OR guest_vlan IS NULL OR known_vlan<>guest_vlan)
);
CREATE TABLE nac_nas_bindings (
  nas_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES nac_profiles(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nac_binding_profile_idx ON nac_nas_bindings(profile_id);
CREATE TABLE nac_mac_rules (
  nas_id uuid NOT NULL,
  mac macaddr NOT NULL,
  mode text NOT NULL CHECK(mode IN ('reject','accept-static','accept-vlan')),
  vlan smallint CHECK(vlan BETWEEN 1 AND 4094),
  note varchar(500) NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(nas_id,mac),
  CONSTRAINT nac_rule_vlan_check CHECK((mode='accept-vlan')=(vlan IS NOT NULL))
);

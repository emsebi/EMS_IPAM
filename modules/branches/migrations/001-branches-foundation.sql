CREATE TABLE IF NOT EXISTS branch_routers (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id text REFERENCES companies(id) ON DELETE SET NULL,
  inventory_host_id text REFERENCES hosts(id) ON DELETE SET NULL,
  name text NOT NULL,
  management_address text NOT NULL,
  public_address text,
  vendor text NOT NULL DEFAULT 'other' CHECK (vendor IN ('mikrotik','cisco','ubiquiti','other')),
  model text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  access_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(access_methods) = 'array')
);

CREATE INDEX IF NOT EXISTS branch_routers_company_idx ON branch_routers(company_id);
CREATE INDEX IF NOT EXISTS branch_routers_branch_idx ON branch_routers(branch_id);
CREATE INDEX IF NOT EXISTS branch_routers_host_idx ON branch_routers(inventory_host_id);

-- No passwords, secrets, API tokens, SNMP communities or private keys are stored here.

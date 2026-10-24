-- v26: reusable write-only NAS shared-secret profiles.
CREATE TABLE IF NOT EXISTS radius_ops_secret_profiles (
  id uuid PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  secret varchar(255) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,name)
);
CREATE INDEX IF NOT EXISTS radius_ops_secret_profiles_company_idx ON radius_ops_secret_profiles(company_id);
ALTER TABLE radius_ops_devices
  ADD COLUMN IF NOT EXISTS secret_profile_id uuid REFERENCES radius_ops_secret_profiles(id) ON DELETE RESTRICT;
INSERT INTO radius_ops_secret_profiles(id,company_id,name,secret,enabled)
SELECT (
  substr(md5('ems-radius-secret:'||d.id::text),1,8)||'-'||substr(md5('ems-radius-secret:'||d.id::text),9,4)||'-'||
  substr(md5('ems-radius-secret:'||d.id::text),13,4)||'-'||substr(md5('ems-radius-secret:'||d.id::text),17,4)||'-'||
  substr(md5('ems-radius-secret:'||d.id::text),21,12)
)::uuid,d.company_id,left('Migrated - '||d.label||' - '||left(d.id::text,8),120),d.secret,true
FROM radius_ops_devices d
WHERE d.secret_profile_id IS NULL
ON CONFLICT(company_id,name) DO NOTHING;
UPDATE radius_ops_devices d
SET secret_profile_id=p.id
FROM radius_ops_secret_profiles p
WHERE d.secret_profile_id IS NULL
  AND p.company_id=d.company_id
  AND p.name=left('Migrated - '||d.label||' - '||left(d.id::text,8),120);
ALTER TABLE radius_ops_devices ALTER COLUMN secret_profile_id SET NOT NULL;

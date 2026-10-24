-- Preserve applied 001 migration; record the actual UDP packet source for audits.
-- NAS-IP-Address is NAS-supplied and MUST NOT be used as a trusted tenant key.
ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS nasipaddress varchar(45);
ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS sourceipaddress varchar(45);
CREATE INDEX IF NOT EXISTS radpostauth_source_time_idx ON radpostauth(sourceipaddress, authdate DESC);

-- Compatibility with optional FreeRADIUS PostgreSQL post-auth Class logging.
-- No credentials or existing rows are changed.
ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS class varchar(64);

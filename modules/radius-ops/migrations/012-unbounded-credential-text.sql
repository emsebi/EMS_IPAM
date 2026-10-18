-- v30: remove EMS-IPAM's arbitrary 128/255-character credential ceilings.
-- FreeRADIUS treats these values as opaque text. Request-size limits still bound
-- the API, and UI/backend validation continues to reject empty/control values.
ALTER TABLE nas ALTER COLUMN secret TYPE text;
ALTER TABLE radcheck ALTER COLUMN value TYPE text;
ALTER TABLE radius_ops_devices ALTER COLUMN secret TYPE text;
ALTER TABLE radius_ops_secret_profiles ALTER COLUMN secret TYPE text;

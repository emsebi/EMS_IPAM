-- v29: safe defaults for first-time RADIUS operators.
-- Collections remain EMS-only groups of registered NAS clients. Permission
-- Profiles remain reusable reply templates. Defaults remove blank-form traps
-- without granting administrative privilege.
INSERT INTO radius_ops_collections(id,company_id,name,description,enabled)
SELECT (
  substr(md5('ems-radius-default-collection:'||c.id),1,8)||'-'||
  substr(md5('ems-radius-default-collection:'||c.id),9,4)||'-'||
  substr(md5('ems-radius-default-collection:'||c.id),13,4)||'-'||
  substr(md5('ems-radius-default-collection:'||c.id),17,4)||'-'||
  substr(md5('ems-radius-default-collection:'||c.id),21,12)
)::uuid,c.id,'Default NAS','Default NAS group for first-time setup',true
FROM companies c
WHERE c.deleted_at IS NULL
ON CONFLICT(company_id,name) DO NOTHING;

INSERT INTO radius_ops_groups(id,company_id,name,description,cisco_privilege,mikrotik_group,enabled)
SELECT (
  substr(md5('ems-radius-default-profile:'||c.id),1,8)||'-'||
  substr(md5('ems-radius-default-profile:'||c.id),9,4)||'-'||
  substr(md5('ems-radius-default-profile:'||c.id),13,4)||'-'||
  substr(md5('ems-radius-default-profile:'||c.id),17,4)||'-'||
  substr(md5('ems-radius-default-profile:'||c.id),21,12)
)::uuid,c.id,'Default Read-Only','Safe default permission profile',1,'read',true
FROM companies c
WHERE c.deleted_at IS NULL
ON CONFLICT(company_id,name) DO NOTHING;

-- Existing NAS objects that have no collection membership are attached to the
-- safe default. NASes already grouped by an operator are left unchanged.
INSERT INTO radius_ops_collection_devices(id,collection_id,device_id)
SELECT (
  substr(md5('ems-radius-default-member:'||d.id::text),1,8)||'-'||
  substr(md5('ems-radius-default-member:'||d.id::text),9,4)||'-'||
  substr(md5('ems-radius-default-member:'||d.id::text),13,4)||'-'||
  substr(md5('ems-radius-default-member:'||d.id::text),17,4)||'-'||
  substr(md5('ems-radius-default-member:'||d.id::text),21,12)
)::uuid,col.id,d.id
FROM radius_ops_devices d
JOIN radius_ops_collections col
  ON col.company_id=d.company_id AND col.name='Default NAS'
WHERE NOT EXISTS(
  SELECT 1 FROM radius_ops_collection_devices cd WHERE cd.device_id=d.id
)
ON CONFLICT(collection_id,device_id) DO NOTHING;

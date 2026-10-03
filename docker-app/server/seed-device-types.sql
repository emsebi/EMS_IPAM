INSERT INTO device_types(id,name,color) VALUES
  ('builtin-server','Server','#3157d5'),
  ('builtin-vm','Virtual Machine','#805ad5'),
  ('builtin-pc','Desktop','#2fa36f'),
  ('builtin-laptop','Laptop','#2b9ca8'),
  ('builtin-thin-client','Thin Client','#64748b'),
  ('builtin-router','Router','#e48a2d'),
  ('builtin-switch','Switch','#3157d5'),
  ('builtin-firewall','Firewall','#d94b5b'),
  ('builtin-modem','Modem','#c2418c'),
  ('builtin-radio','Radio','#2fa36f'),
  ('builtin-camera','Camera','#64748b'),
  ('builtin-ap','Access Point','#2b9ca8'),
  ('builtin-printer','Printer','#e48a2d'),
  ('builtin-other','Other','#64748b')
ON CONFLICT(name) DO NOTHING;

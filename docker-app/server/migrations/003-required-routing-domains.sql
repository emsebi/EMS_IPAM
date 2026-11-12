-- Core holds the migration transaction and records the checksum after this SQL succeeds.
LOCK TABLE companies, routing_domains IN SHARE MODE NOWAIT;
LOCK TABLE address_spaces IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $backfill$
DECLARE
  missing_company text;
BEGIN
  SELECT c.id INTO missing_company
  FROM companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM routing_domains d WHERE d.company_id = c.id AND d.is_default
  )
  ORDER BY c.id LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Missing default routing domain for company %', missing_company
      USING ERRCODE = '23514';
  END IF;
END;
$backfill$;

UPDATE address_spaces s SET routing_domain_id = d.id
FROM routing_domains d
WHERE s.company_id = d.company_id AND d.is_default AND s.routing_domain_id IS NULL;

-- The legacy Company/CIDR key remains in effect during this compatibility phase.
ALTER TABLE address_spaces
  ALTER COLUMN routing_domain_id SET NOT NULL,
  ADD CONSTRAINT space_domain_cidr_key UNIQUE (company_id, routing_domain_id, cidr);

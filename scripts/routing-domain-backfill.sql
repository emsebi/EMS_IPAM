-- Rehearse on a restored database after migration 002.
-- psql -X --single-transaction -v ON_ERROR_STOP=1 -f scripts/routing-domain-backfill.sql
-- Refuse a standalone psql invocation without a transaction at the LOCK below.
\set ON_ERROR_STOP on

-- Keep defaults and Space bindings stable between the check and the update.
LOCK TABLE companies, routing_domains, address_spaces IN EXCLUSIVE MODE NOWAIT;

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

WITH assigned AS (
  UPDATE address_spaces s SET routing_domain_id = d.id
  FROM routing_domains d
  WHERE s.routing_domain_id IS NULL AND s.company_id = d.company_id AND d.is_default
  RETURNING s.company_id, s.id AS space_id, s.routing_domain_id,
            CASE WHEN s.deleted_at IS NULL THEN 'active' ELSE 'recycled' END AS space_state
)
SELECT company_id, space_id, routing_domain_id, space_state, statement_timestamp() AS assigned_at
FROM assigned ORDER BY company_id, space_id;

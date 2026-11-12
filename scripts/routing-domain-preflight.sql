-- Run on a restored EMS_IPAM database after migration 002, using a read-only role:
-- psql -X -v ON_ERROR_STOP=1 -f scripts/routing-domain-preflight.sql
-- Each row identifies an unbound Space or a company missing its default domain.
-- A NULL Space ID means that company has no unbound Spaces. Zero rows clears these two checks.
SELECT statement_timestamp() AS checked_at,
       c.id AS company_id,
       d.id AS default_domain_id,
       d.id IS NULL AS missing_default,
       s.id AS unbound_space_id,
       CASE WHEN s.id IS NULL THEN NULL
            WHEN s.deleted_at IS NULL THEN 'active'
            ELSE 'recycled'
       END AS space_state
FROM companies c
LEFT JOIN routing_domains d ON d.company_id = c.id AND d.is_default
LEFT JOIN address_spaces s ON s.company_id = c.id AND s.routing_domain_id IS NULL
WHERE d.id IS NULL OR s.id IS NOT NULL
ORDER BY c.id, s.id;

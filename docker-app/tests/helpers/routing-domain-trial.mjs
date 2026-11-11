// Candidate MS-03 SQL shared by migration rehearsals. Never loaded by the application.
export const expand = `
  CREATE TABLE routing_domains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    UNIQUE (company_id, id)
  );
  CREATE UNIQUE INDEX routing_domains_one_default ON routing_domains(company_id) WHERE is_default;
  ALTER TABLE address_spaces ADD COLUMN routing_domain_id uuid,
    ADD CONSTRAINT space_domain_company_fk FOREIGN KEY (company_id, routing_domain_id)
      REFERENCES routing_domains(company_id, id);
`;
export const backfill = `
  INSERT INTO routing_domains(company_id, name, is_default)
    SELECT id, 'Default', true FROM companies
    ON CONFLICT (company_id) WHERE is_default DO NOTHING;
  UPDATE address_spaces s SET routing_domain_id = d.id
    FROM routing_domains d
    WHERE s.company_id = d.company_id AND d.is_default AND s.routing_domain_id IS NULL;
`;

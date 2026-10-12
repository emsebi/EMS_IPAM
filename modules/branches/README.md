# Branches & Routers

Independent EMS-IPAM module foundation for branch and router inventory. A branch belongs to a company. A router may belong to a branch or remain unassigned, may reference an existing IPAM host, has management/public addressing and protocol/port access methods, and never stores passwords, secrets, community strings or tokens.

The model and integrity preflight are pure/offline. Persistence, authenticated company-scoped API and panel UI are added as separate module packages. No router connection or automatic configuration is performed.

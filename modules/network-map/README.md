# Network Map — phase 1 foundation

This is an **isolated, admin-only foundation**, not a completed discovery engine.

- `GET /api/network-map/snapshots` returns the 20 latest saved topology snapshots.
- `POST /api/network-map/snapshots` saves a validated, manual JSON topology.
- Nodes: `[{ "id":"sw1", "name":"Core", "address":"192.0.2.10", "platform":"Cisco" }]`
- Links: `[{ "source":"sw1", "target":"sw2", "sourcePort":"Gi1/0/1", "targetPort":"Gi1/0/24" }]`
- Data is stored in a separate PostgreSQL table, with no changes to IPAM or RADIUS tables.
- The API requires an authenticated administrator; it does not log in to network devices.

Next increments: read-only credentials and explicit manual discovery; LLDP/CDP collection and port mapping; MAC forwarding-table tracing; topology UI. No automatic polling, switch configuration, or network scans are included in this commit.

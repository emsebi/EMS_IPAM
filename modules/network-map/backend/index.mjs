import crypto from "node:crypto";

const MAX_NODES = 500;
const MAX_LINKS = 2000;
const clean = (value, limit = 128) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function validateSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("Invalid snapshot.");
  if (!Array.isArray(input.nodes) || !Array.isArray(input.links)) throw badRequest("Nodes and links must be arrays.");
  if (input.nodes.length > MAX_NODES || input.links.length > MAX_LINKS) throw badRequest("Topology size limit exceeded.");
  const ids = new Set();
  const nodes = input.nodes.map((node) => {
    const id = clean(node?.id, 100), name = clean(node?.name, 128);
    if (!id || !name || ids.has(id)) throw badRequest("Each node needs a unique ID and name.");
    ids.add(id);
    return { id, name, address: clean(node.address, 255), platform: clean(node.platform, 100) };
  });
  const links = input.links.map((link) => {
    const source = clean(link?.source, 100), target = clean(link?.target, 100);
    if (!ids.has(source) || !ids.has(target) || source === target) throw badRequest("Invalid link endpoints.");
    return { source, target, sourcePort: clean(link.sourcePort, 100), targetPort: clean(link.targetPort, 100) };
  });
  return { nodes, links };
}

export function createModule(ctx) {
  const { pool, json, readBody, requireAdmin, audit } = ctx;
  let ready;
  const ensureSchema = () => {
    ready ??= pool.query(`CREATE TABLE IF NOT EXISTS network_map_snapshots (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      snapshot jsonb NOT NULL
    )`).catch((error) => { ready = undefined; throw error; });
    return ready;
  };
  return {
    match: (req, url) => url.pathname === "/api/network-map/snapshots" &&
      ["GET", "POST"].includes(req.method),
    async handle(req, res, url, user) {
      requireAdmin(user);
      await ensureSchema();
      if (req.method === "GET") {
        const result = await pool.query(
          "SELECT id, created_at AS \"createdAt\", created_by AS \"createdBy\", source, snapshot FROM network_map_snapshots ORDER BY created_at DESC LIMIT 20"
        );
        return json(res, 200, { ok: true, items: result.rows });
      }
      const snapshot = validateSnapshot(await readBody(req));
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO network_map_snapshots(id, created_by, source, snapshot) VALUES($1,$2,$3,$4::jsonb)",
        [id, String(user?.username ?? user?.id ?? "admin"), "manual", JSON.stringify(snapshot)]
      );
      await audit(user, "create", "network_map_snapshot", id);
      return json(res, 201, { ok: true, id });
    }
  };
}

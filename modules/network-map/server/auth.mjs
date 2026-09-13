import crypto from "node:crypto";

function parseCookies(header) {
  const output = {};
  for (const item of String(header || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    output[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return output;
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export async function currentUser(pool, req) {
  const token = parseCookies(req.headers.cookie).ems_session;
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name AS "displayName",u.role,u.active
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
    [tokenHash(token)],
  );
  return result.rows[0] || null;
}

export function requireWriter(user) {
  if (!user || !["admin", "editor"].includes(user.role)) {
    throw Object.assign(new Error("دسترسی ویرایش ندارید."), { status: 403 });
  }
}

export function requireAdmin(user) {
  if (!user || user.role !== "admin") {
    throw Object.assign(new Error("این عملیات فقط برای مدیر سیستم مجاز است."), { status: 403 });
  }
}

export async function canAccessCompany(pool, user, companyId) {
  if (!user) return false;
  const active = await pool.query("SELECT 1 FROM companies WHERE id=$1 AND deleted_at IS NULL", [companyId]);
  if (!active.rowCount) return false;
  if (user.role === "admin") return true;
  const found = await pool.query(
    `SELECT 1 FROM user_company_access WHERE user_id=$1 AND company_id=$2
     UNION ALL
     SELECT 1 FROM user_space_access usa JOIN address_spaces s ON s.id=usa.space_id
      WHERE usa.user_id=$1 AND s.company_id=$2 LIMIT 1`,
    [user.id, companyId],
  );
  return found.rowCount > 0;
}

export async function canManageCompany(pool, user, companyId) {
  if (!user || !["admin", "editor"].includes(user.role)) return false;
  if (user.role === "admin") return true;
  return (await pool.query(
    "SELECT 1 FROM user_company_access WHERE user_id=$1 AND company_id=$2",
    [user.id, companyId],
  )).rowCount > 0;
}

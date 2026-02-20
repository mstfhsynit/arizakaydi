const { run } = require("../db/database");

const LOG_ACTIONS = new Set(["login", "logout", "delete_ticket", "role_change"]);

function extractIpAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  const direct =
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    "";
  return String(direct || "").trim() || null;
}

async function logSystemAction({ userId = null, action, ipAddress = null }) {
  if (!LOG_ACTIONS.has(action)) {
    return;
  }

  const parsedUserId = Number(userId);
  const safeUserId = Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
  const safeIp = typeof ipAddress === "string" ? ipAddress.trim() || null : null;

  await run(
    `
    INSERT INTO system_logs (user_id, action, ip_address)
    VALUES (?, ?, ?)
    `,
    [safeUserId, action, safeIp]
  );
}

function authorizeSuperAdminOnly(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== "super_admin" && role !== "manager") {
    res.status(403).json({ message: "Bu işlem için süper yönetici yetkisi gereklidir." });
    return;
  }
  next();
}

module.exports = {
  LOG_ACTIONS,
  extractIpAddress,
  logSystemAction,
  authorizeSuperAdminOnly,
};

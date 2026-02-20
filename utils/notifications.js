const { all, run } = require("../db/database");

function normalizeUserIds(userIds = []) {
  const unique = new Set();
  userIds.forEach((id) => {
    const parsed = Number(id);
    if (Number.isInteger(parsed) && parsed > 0) {
      unique.add(parsed);
    }
  });
  return Array.from(unique);
}

async function createNotifications(userIds, message) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) return;

  const ids = normalizeUserIds(userIds);
  if (!ids.length) return;

  for (const userId of ids) {
    await run(
      `
      INSERT INTO notifications (user_id, message, is_read)
      VALUES (?, ?, 0)
      `,
      [userId, normalizedMessage]
    );
  }
}

async function listAdminIds(excludeUserId = null) {
  const params = [];
  let whereClause = "WHERE role = 'admin'";

  const excludeId = Number(excludeUserId);
  if (Number.isInteger(excludeId) && excludeId > 0) {
    whereClause += " AND id != ?";
    params.push(excludeId);
  }

  const rows = await all(
    `
    SELECT id
    FROM users
    ${whereClause}
    `,
    params
  );
  return rows.map((row) => row.id);
}

async function notifyTicketCreated({ ticketId, actorId }) {
  const admins = await listAdminIds(actorId);
  await createNotifications(admins, `Yeni kayıt oluşturuldu. (ID: ${ticketId})`);
}

async function notifyCommentAdded({ ticketId, commenterId, ownerId }) {
  const ownerUserId = Number(ownerId);
  const actorUserId = Number(commenterId);

  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) return;
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) return;

  if (actorUserId === ownerUserId) {
    const admins = await listAdminIds(actorUserId);
    await createNotifications(admins, `Kayıt #${ticketId} için yeni yorum eklendi.`);
    return;
  }

  await createNotifications(
    [ownerUserId],
    `Kayıt #${ticketId} için size yeni bir yorum eklendi.`
  );
}

async function notifyStatusChanged({ ticketId, actorId, ownerId, status }) {
  const ownerUserId = Number(ownerId);
  const actorUserId = Number(actorId);
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) return;
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) return;
  if (ownerUserId === actorUserId) return;

  await createNotifications(
    [ownerUserId],
    `Kayıt #${ticketId} durumu "${status}" olarak güncellendi.`
  );
}

module.exports = {
  createNotifications,
  notifyTicketCreated,
  notifyCommentAdded,
  notifyStatusChanged,
};

const onlineUsers = new Map();

function toInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function sanitizeUser(user = {}) {
  const id = toInt(user.id);
  if (!id) {
    return null;
  }

  return {
    id,
    ad: String(user.ad || ""),
    soyad: String(user.soyad || ""),
    username: String(user.username || ""),
    role: String(user.role || ""),
  };
}

function serializeOnlineUser(entry) {
  return {
    id: entry.id,
    ad: entry.ad,
    soyad: entry.soyad,
    username: entry.username,
    role: entry.role,
    connected_at: entry.connectedAt,
    connections: entry.socketIds.size,
  };
}

function listOnlineUsers() {
  const rows = Array.from(onlineUsers.values()).map(serializeOnlineUser);
  rows.sort((a, b) => {
    const roleCompare = String(a.role).localeCompare(String(b.role), "tr");
    if (roleCompare !== 0) return roleCompare;

    const nameA = `${a.ad} ${a.soyad}`.trim();
    const nameB = `${b.ad} ${b.soyad}`.trim();
    const nameCompare = nameA.localeCompare(nameB, "tr");
    if (nameCompare !== 0) return nameCompare;

    return a.id - b.id;
  });
  return rows;
}

function connectOnlineUser(user, socketId) {
  const normalized = sanitizeUser(user);
  if (!normalized || !socketId) {
    return {
      user: null,
      wasOffline: false,
    };
  }

  const current = onlineUsers.get(normalized.id);
  if (current) {
    current.socketIds.add(socketId);
    return {
      user: serializeOnlineUser(current),
      wasOffline: false,
    };
  }

  const entry = {
    ...normalized,
    connectedAt: new Date().toISOString(),
    socketIds: new Set([socketId]),
  };
  onlineUsers.set(entry.id, entry);

  return {
    user: serializeOnlineUser(entry),
    wasOffline: true,
  };
}

function disconnectOnlineUser(userId, socketId) {
  const id = toInt(userId);
  if (!id || !socketId) {
    return {
      user: null,
      wentOffline: false,
    };
  }

  const entry = onlineUsers.get(id);
  if (!entry) {
    return {
      user: null,
      wentOffline: false,
    };
  }

  entry.socketIds.delete(socketId);
  if (entry.socketIds.size > 0) {
    return {
      user: serializeOnlineUser(entry),
      wentOffline: false,
    };
  }

  onlineUsers.delete(id);
  return {
    user: serializeOnlineUser(entry),
    wentOffline: true,
  };
}

module.exports = {
  onlineUsers,
  listOnlineUsers,
  connectOnlineUser,
  disconnectOnlineUser,
};

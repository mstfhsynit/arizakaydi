const fs = require("fs");
const path = require("path");
const express = require("express");
const { all, run, get } = require("../db/database");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const {
  attachmentUpload,
  sendUploadError,
  toAttachmentPath,
  resolveAttachmentPath,
  removeUploadedFile,
} = require("../middleware/upload");
const {
  BLOKS,
  KATEGORILER,
  ALT_KATEGORILER,
  ACILIYET,
  DURUM,
} = require("../utils/constants");
const {
  validateCreateRequest,
  validateStatus,
  validateTicketComment,
} = require("../utils/validators");
const {
  notifyTicketCreated,
  notifyCommentAdded,
  notifyStatusChanged,
} = require("../utils/notifications");
const { extractIpAddress, logSystemAction } = require("../utils/system-logs");

const router = express.Router();

const HISTORY_ACTIONS = new Set([
  "created",
  "status_changed",
  "commented",
  "file_uploaded",
  "closed",
]);

async function findRequestById(requestId) {
  return get(
    `
    SELECT
      r.id,
      r.user_id
    FROM requests r
    WHERE r.id = ?
    `,
    [requestId]
  );
}

function hasAccessToRequest(user, requestRow) {
  if (!user || !requestRow) return false;
  if (user.role === "user") {
    return requestRow.user_id === user.id;
  }
  return true;
}

function buildRequestScope(user, alias = "r") {
  if (user && user.role === "user") {
    return {
      where: `WHERE ${alias}.user_id = ?`,
      params: [user.id],
    };
  }

  return {
    where: "",
    params: [],
  };
}

function appendWhereCondition(whereClause, condition) {
  if (!whereClause) {
    return `WHERE ${condition}`;
  }
  return `${whereClause} AND ${condition}`;
}

function toUtcDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStatusText(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toInternalStatus(value = "") {
  const normalized = normalizeStatusText(value);
  if (normalized === "bekleniyor") return "Bekleniyor";
  if (normalized === "islemde") return "Islemde";
  if (normalized === "cozuldu" || normalized === "kapatildi") return "Cozuldu";
  return String(value || "").trim();
}

function isResolvedStatus(value = "") {
  const normalized = normalizeStatusText(value);
  return normalized === "cozuldu" || normalized === "kapatildi";
}

function formatStatusDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds < 60) {
    return `${seconds} saniye`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dakika`;
  }

  const hours = Math.floor(seconds / 3600);
  const minuteRest = Math.floor((seconds % 3600) / 60);
  if (hours < 24) {
    if (minuteRest > 0) {
      return `${hours} saat ${minuteRest} dakika`;
    }
    return `${hours} saat`;
  }

  const days = Math.floor(seconds / 86400);
  const hourRest = Math.floor((seconds % 86400) / 3600);
  if (days < 30) {
    if (hourRest > 0) {
      return `${days} g\u00FCn ${hourRest} saat`;
    }
    return `${days} g\u00FCn`;
  }

  const months = Math.floor(days / 30);
  const dayRest = days % 30;
  if (months < 12) {
    if (dayRest > 0) {
      return `${months} ay ${dayRest} g\u00FCn`;
    }
    return `${months} ay`;
  }

  const years = Math.floor(days / 365);
  const monthRest = Math.floor((days % 365) / 30);
  if (monthRest > 0) {
    return `${years} y\u0131l ${monthRest} ay`;
  }
  return `${years} y\u0131l`;
}

function formatResolutionDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds >= 24 * 60 * 60) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    if (hours > 0) {
      return `${days} gün ${hours} saat`;
    }
    return `${days} gün`;
  }

  if (seconds >= 60 * 60) {
    const hours = Math.floor(seconds / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    if (minutes > 0) {
      return `${hours} saat ${minutes} dakika`;
    }
    return `${hours} saat`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes} dakika`;
}

function withStatusDurations(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return safeRows.map((row, index) => {
    const nextRow = safeRows[index + 1];
    if (!nextRow) {
      return Object.assign({}, row, {
        duration_seconds: null,
        duration_text: null,
      });
    }

    const currentMillis = new Date(row.changed_at).getTime();
    const nextMillis = new Date(nextRow.changed_at).getTime();
    if (!Number.isFinite(currentMillis) || !Number.isFinite(nextMillis) || nextMillis < currentMillis) {
      return Object.assign({}, row, {
        duration_seconds: null,
        duration_text: null,
      });
    }

    const durationSeconds = Math.floor((nextMillis - currentMillis) / 1000);
    return Object.assign({}, row, {
      duration_seconds: durationSeconds,
      duration_text: formatStatusDuration(durationSeconds),
    });
  });
}

async function logTicketHistory(ticketId, userId, action) {
  if (!HISTORY_ACTIONS.has(action)) {
    return;
  }

  await run(
    `
    INSERT INTO ticket_history (ticket_id, user_id, action)
    VALUES (?, ?, ?)
    `,
    [ticketId, userId, action]
  );
}

async function getStatusHistoryController(req, res) {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ message: "Geçersiz kayıt id." });
      return;
    }

    const requestRow = await findRequestById(requestId);
    if (!requestRow) {
      res.status(404).json({ message: "Kayıt bulunamadı." });
      return;
    }

    if (!hasAccessToRequest(req.user, requestRow)) {
      res.status(403).json({ message: "Bu kaydın durum geçmişini görüntüleme yetkiniz yok." });
      return;
    }

    const rows = await all(
      `
      SELECT
        id,
        ticket_id,
        old_status,
        new_status,
        changed_at
      FROM status_history
      WHERE ticket_id = ?
      ORDER BY datetime(changed_at) ASC, id ASC
      `,
      [requestId]
    );

    res.json(withStatusDurations(rows));
  } catch (error) {
    res.status(500).json({ message: "Durum geçmişi alınamadı." });
  }
}

async function getSolutionDurationController(req, res) {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ message: "Geçersiz kayıt id." });
      return;
    }

    const row = await get(
      `
      SELECT
        r.id AS ticket_id,
        r.user_id,
        r.durum,
        r.created_at,
        r.resolved_at,
        r.resolved_duration
      FROM requests r
      WHERE r.id = ?
      `,
      [requestId]
    );

    if (!row) {
      res.status(404).json({ message: "Kayıt bulunamadı." });
      return;
    }

    if (!hasAccessToRequest(req.user, row)) {
      res.status(403).json({ message: "Bu kaydın çözüm süresini görüntüleme yetkiniz yok." });
      return;
    }

    if (!isResolvedStatus(row.durum)) {
      res.json({
        ongoing: true,
        duration: null,
      });
      return;
    }

    const durationSeconds = Number(row.resolved_duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      res.json({
        ongoing: false,
        duration: null,
      });
      return;
    }

    res.json({
      ongoing: false,
      duration: formatResolutionDuration(durationSeconds),
    });
  } catch (error) {
    res.status(500).json({ message: "Çözüm süresi alınamadı." });
  }
}

router.get("/options", authenticateToken, (req, res) => {
  res.json({
    bloklar: BLOKS,
    kategoriler: KATEGORILER,
    altKategoriler: ALT_KATEGORILER,
    aciliyet: ACILIYET,
    durumlar: DURUM,
  });
});

router.get(
  "/summary",
  authenticateToken,
  authorizeRoles("user", "admin", "manager", "super_admin"),
  async (req, res) => {
    try {
      const scope = buildRequestScope(req.user, "r");

      const cardRow = await get(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN r.durum = 'Bekleniyor' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN r.durum = 'Islemde' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN r.durum = 'Cozuldu' THEN 1 ELSE 0 END) AS resolved
        FROM requests r
        ${scope.where}
        `,
        scope.params
      );

      const lineWhere = appendWhereCondition(scope.where, "date(r.created_at) >= date('now', '-6 day')");
      const lineRows = await all(
        `
        SELECT date(r.created_at) AS day, COUNT(*) AS count
        FROM requests r
        ${lineWhere}
        GROUP BY date(r.created_at)
        ORDER BY date(r.created_at) ASC
        `,
        scope.params
      );

      const lineMap = new Map(
        lineRows.map((row) => [String(row.day), Number(row.count) || 0])
      );

      const last7Days = [];
      for (let i = 6; i >= 0; i -= 1) {
        const date = new Date();
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - i);

        const dayKey = toUtcDateKey(date);
        const label = date.toLocaleDateString("tr-TR", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "UTC",
        });

        last7Days.push({
          date: dayKey,
          label,
          count: lineMap.get(dayKey) || 0,
        });
      }

      const cards = {
        total: Number(cardRow && cardRow.total) || 0,
        pending: Number(cardRow && cardRow.pending) || 0,
        in_progress: Number(cardRow && cardRow.in_progress) || 0,
        resolved: Number(cardRow && cardRow.resolved) || 0,
      };

      const statusDistribution = [
        { key: "pending", status: "Bekleniyor", count: cards.pending },
        { key: "in_progress", status: "Islemde", count: cards.in_progress },
        { key: "resolved", status: "Cozuldu", count: cards.resolved },
      ];

      res.json({
        cards,
        last7Days,
        statusDistribution,
      });
    } catch (error) {
      res.status(500).json({ message: "Gösterge paneli özeti alınamadı." });
    }
  }
);

router.post(
  "/",
  authenticateToken,
  authorizeRoles("user", "manager"),
  (req, res, next) => {
    attachmentUpload(req, res, (error) => {
      if (error) {
        if (!sendUploadError(res, error)) {
          res.status(500).json({ message: "Dosya yükleme hatası." });
        }
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { errors, cleaned } = validateCreateRequest(req.body);
      if (errors.length) {
        await removeUploadedFile(req.file);
        res.status(400).json({ message: errors.join(" ") });
        return;
      }

      const result = await run(
        `
        INSERT INTO requests (
          user_id,
          ad_soyad,
          blok,
          kategori,
          alt_kategori,
          aciliyet,
          aciklama,
          attachment_path
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.id,
          cleaned.adSoyad,
          cleaned.blok,
          cleaned.kategori,
          cleaned.alt_kategori,
          cleaned.aciliyet,
          cleaned.aciklama || null,
          req.file ? toAttachmentPath(req.file.filename) : null,
        ]
      );

      await logTicketHistory(result.lastID, req.user.id, "created");
      if (req.file) {
        await logTicketHistory(result.lastID, req.user.id, "file_uploaded");
      }
      await notifyTicketCreated({
        ticketId: result.lastID,
        actorId: req.user.id,
      });

      res.status(201).json({ message: "Kayıt oluşturuldu." });
    } catch (error) {
      await removeUploadedFile(req.file);
      res.status(500).json({ message: "Kayıt oluşturulurken hata oluştu." });
    }
  }
);

router.get("/my", authenticateToken, authorizeRoles("user"), async (req, res) => {
  try {
    const rows = await all(
      `
      SELECT
        id,
        ad_soyad,
        blok,
        kategori,
        alt_kategori,
        aciliyet,
        aciklama,
        attachment_path,
        durum,
        created_at
      FROM requests
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      `,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Kayıtlar alınamadı." });
  }
});

router.get(
  "/",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  async (req, res) => {
    try {
      const filters = [];
      const params = [];

      const allowed = {
        blok: BLOKS,
        kategori: KATEGORILER,
        durum: DURUM,
        aciliyet: ACILIYET,
      };

      for (const [key, list] of Object.entries(allowed)) {
        const value = typeof req.query[key] === "string" ? req.query[key].trim() : "";
        if (value) {
          if (!list.includes(value)) {
            res.status(400).json({ message: `${key} filtresi geçersiz.` });
            return;
          }
          filters.push(`r.${key} = ?`);
          params.push(value);
        }
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await all(
        `
        SELECT
          r.id,
          r.ad_soyad,
          COALESCE(NULLIF(TRIM(r.ad_soyad), ''), u.ad || ' ' || u.soyad) AS acan_kisi,
          r.blok,
          r.kategori,
          r.alt_kategori,
          r.aciliyet,
          r.aciklama,
          r.attachment_path,
          r.durum,
          r.created_at,
          r.user_id,
          u.ad,
          u.soyad,
          u.username
        FROM requests r
        JOIN users u ON u.id = r.user_id
        ${where}
        ORDER BY datetime(r.created_at) DESC, r.id DESC
        `,
        params
      );

      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Tüm kayıtlar alınamadı." });
    }
  }
);

router.delete(
  "/delete-resolved",
  authenticateToken,
  authorizeRoles("user", "admin", "manager", "super_admin"),
  async (req, res) => {
    try {
      let whereClause = "durum = ?";
      const params = ["Cozuldu"];

      if (req.user.role === "user") {
        whereClause += " AND user_id = ?";
        params.push(req.user.id);
      }

      const countRow = await get(`SELECT COUNT(*) AS count FROM requests WHERE ${whereClause}`, params);
      const count = Number(countRow && countRow.count) || 0;
      if (!count) {
        res.json({
          message: "Silinecek çözülen kayıt bulunamadı.",
          deletedCount: 0,
        });
        return;
      }

      const result = await run(`DELETE FROM requests WHERE ${whereClause}`, params);
      if (result.changes > 0) {
        await logSystemAction({
          userId: req.user.id,
          action: "delete_ticket",
          ipAddress: extractIpAddress(req),
        });
      }

      res.json({
        message: "Çözülen kayıtlar silindi.",
        deletedCount: Number(result.changes) || 0,
      });
    } catch (error) {
      res.status(500).json({ message: "Çözülen kayıtlar silinemedi." });
    }
  }
);

router.get(
  "/:id/history",
  authenticateToken,
  authorizeRoles("user", "admin", "manager"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const requestRow = await findRequestById(requestId);
      if (!requestRow) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      if (!hasAccessToRequest(req.user, requestRow)) {
        res.status(403).json({ message: "Bu kaydın geçmişini görüntüleme yetkiniz yok." });
        return;
      }

      const rows = await all(
        `
        SELECT
          h.id,
          h.ticket_id,
          h.user_id,
          h.action,
          h.created_at,
          u.ad,
          u.soyad,
          u.role
        FROM ticket_history h
        JOIN users u ON u.id = h.user_id
        WHERE h.ticket_id = ?
        ORDER BY datetime(h.created_at) ASC, h.id ASC
        `,
        [requestId]
      );

      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Kayıt geçmişi alınamadı." });
    }
  }
);

router.get(
  "/:id/status-history",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  getStatusHistoryController
);

router.get(
  "/:id/resolution-duration",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  getSolutionDurationController
);

router.get(
  "/:id/solution-duration",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  getSolutionDurationController
);

router.get(
  "/:id/comments",
  authenticateToken,
  authorizeRoles("user", "admin", "manager"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const requestRow = await findRequestById(requestId);
      if (!requestRow) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      if (!hasAccessToRequest(req.user, requestRow)) {
        res.status(403).json({ message: "Bu kaydın yorumlarını görüntüleme yetkiniz yok." });
        return;
      }

      const rows = await all(
        `
        SELECT
          c.id,
          c.ticket_id,
          c.user_id,
          c.comment,
          c.created_at,
          c.updated_at,
          u.ad,
          u.soyad,
          u.role
        FROM ticket_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.ticket_id = ?
        ORDER BY datetime(c.created_at) ASC, c.id ASC
        `,
        [requestId]
      );

      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Yorumlar alınamadı." });
    }
  }
);

router.post(
  "/:id/comments",
  authenticateToken,
  authorizeRoles("user", "admin"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const requestRow = await findRequestById(requestId);
      if (!requestRow) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      if (!hasAccessToRequest(req.user, requestRow)) {
        res.status(403).json({ message: "Bu kayda yorum yapma yetkiniz yok." });
        return;
      }

      const { error, value } = validateTicketComment(req.body.comment);
      if (error) {
        res.status(400).json({ message: error });
        return;
      }

      await run(
        `
        INSERT INTO ticket_comments (ticket_id, user_id, comment)
        VALUES (?, ?, ?)
        `,
        [requestId, req.user.id, value]
      );
      await logTicketHistory(requestId, req.user.id, "commented");
      await notifyCommentAdded({
        ticketId: requestId,
        commenterId: req.user.id,
        ownerId: requestRow.user_id,
      });

      res.status(201).json({ message: "Yorum eklendi." });
    } catch (error) {
      res.status(500).json({ message: "Yorum eklenemedi." });
    }
  }
);

router.get("/:id", authenticateToken, authorizeRoles("user", "admin", "manager"), async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ message: "Geçersiz kayıt id." });
      return;
    }

    const row = await get(
      `
      SELECT
        r.id,
        r.ad_soyad,
        COALESCE(NULLIF(TRIM(r.ad_soyad), ''), u.ad || ' ' || u.soyad) AS acan_kisi,
        r.blok,
        r.kategori,
        r.alt_kategori,
        r.aciliyet,
        r.aciklama,
        r.attachment_path,
        r.durum,
        r.created_at,
        r.resolved_at,
        r.resolved_duration,
        r.user_id,
        u.ad,
        u.soyad,
        u.username
      FROM requests r
      JOIN users u ON u.id = r.user_id
      WHERE r.id = ?
      `,
      [requestId]
    );

    if (!row) {
      res.status(404).json({ message: "Kayıt bulunamadı." });
      return;
    }

    if (req.user.role === "user" && row.user_id !== req.user.id) {
      res.status(403).json({ message: "Bu kaydı görüntüleme yetkiniz yok." });
      return;
    }

    res.json(row);
  } catch (error) {
    res.status(500).json({ message: "Kayıt detayı alınamadı." });
  }
});

router.get(
  "/:id/attachment",
  authenticateToken,
  authorizeRoles("user", "admin", "manager"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const row = await get(
        "SELECT id, user_id, attachment_path FROM requests WHERE id = ?",
        [requestId]
      );
      if (!row) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      if (req.user.role === "user" && row.user_id !== req.user.id) {
        res.status(403).json({ message: "Bu dosyayı indirme yetkiniz yok." });
        return;
      }

      if (!row.attachment_path) {
        res.status(404).json({ message: "Bu kayda ait dosya bulunamadı." });
        return;
      }

      const absolutePath = resolveAttachmentPath(row.attachment_path);
      if (!absolutePath) {
        res.status(404).json({ message: "Dosya bulunamadı." });
        return;
      }

      await fs.promises.access(absolutePath, fs.constants.R_OK);

      const ext = path.extname(absolutePath);
      const fileName = `request-${row.id}-attachment${ext}`;
      res.download(absolutePath, fileName, (error) => {
        if (error && !res.headersSent) {
          res.status(500).json({ message: "Dosya indirilemedi." });
        }
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        res.status(404).json({ message: "Dosya bulunamadı." });
        return;
      }
      res.status(500).json({ message: "Dosya indirilemedi." });
    }
  }
);

router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("admin", "manager", "super_admin"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const row = await get("SELECT id, durum FROM requests WHERE id = ?", [requestId]);
      if (!row) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      if (!isResolvedStatus(row.durum)) {
        res.status(400).json({ message: "Sadece çözülen kayıtlar silinebilir." });
        return;
      }

      const result = await run("DELETE FROM requests WHERE id = ?", [requestId]);
      if (!result.changes) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      await logSystemAction({
        userId: req.user.id,
        action: "delete_ticket",
        ipAddress: extractIpAddress(req),
      });

      res.json({ message: "Kayıt silindi." });
    } catch (error) {
      res.status(500).json({ message: "Kayıt silinemedi." });
    }
  }
);

router.patch(
  "/:id/status",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        res.status(400).json({ message: "Geçersiz kayıt id." });
        return;
      }

      const requestRow = await get(
        "SELECT id, user_id, durum, created_at, resolved_at, resolved_duration FROM requests WHERE id = ?",
        [requestId]
      );
      if (!requestRow) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }

      const normalizedStatus = toInternalStatus(req.body.durum);
      const status = validateStatus(normalizedStatus);
      if (!status) {
        res.status(400).json({ message: "Geçersiz durum seçimi." });
        return;
      }

      const willBeResolved = isResolvedStatus(status);
      let result;

      if (willBeResolved && !requestRow.resolved_at) {
        result = await run(
          `
          UPDATE requests
          SET
            durum = ?,
            resolved_at = CURRENT_TIMESTAMP,
            resolved_duration = CASE
              WHEN resolved_duration IS NULL THEN
                CASE
                  WHEN (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at)) < 0 THEN 0
                  ELSE CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER)
                END
              ELSE resolved_duration
            END
          WHERE id = ?
          `,
          [status, requestId]
        );
      } else if (
        willBeResolved &&
        requestRow.resolved_at &&
        (requestRow.resolved_duration === null || requestRow.resolved_duration === undefined)
      ) {
        result = await run(
          `
          UPDATE requests
          SET
            durum = ?,
            resolved_duration = CASE
              WHEN (strftime('%s', resolved_at) - strftime('%s', created_at)) < 0 THEN 0
              ELSE CAST(strftime('%s', resolved_at) - strftime('%s', created_at) AS INTEGER)
            END
          WHERE id = ?
          `,
          [status, requestId]
        );
      } else {
        result = await run("UPDATE requests SET durum = ? WHERE id = ?", [status, requestId]);
      }

      if (!result.changes) {
        res.status(404).json({ message: "Kayıt bulunamadı." });
        return;
      }
      if (requestRow.durum !== status) {
        await run(
          `
          INSERT INTO status_history (ticket_id, old_status, new_status)
          VALUES (?, ?, ?)
          `,
          [requestId, requestRow.durum, status]
        );
      }

      await logTicketHistory(requestId, req.user.id, "status_changed");
      if (isResolvedStatus(status)) {
        await logTicketHistory(requestId, req.user.id, "closed");
      }
      if (requestRow) {
        await notifyStatusChanged({
          ticketId: requestId,
          actorId: req.user.id,
          ownerId: requestRow.user_id,
          status,
        });
      }

      res.json({ message: "Durum güncellendi." });
    } catch (error) {
      res.status(500).json({ message: "Durum güncellenemedi." });
    }
  }
);

module.exports = router;


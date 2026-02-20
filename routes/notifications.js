const express = require("express");
const { all, get, run } = require("../db/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

router.get("/", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const rows = await all(
      `
      SELECT id, user_id, message, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?
      `,
      [req.user.id, limit]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Bildirimler alınamadı." });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const row = await get(
      `
      SELECT COUNT(*) AS unread_count
      FROM notifications
      WHERE user_id = ? AND is_read = 0
      `,
      [req.user.id]
    );

    res.json({ unreadCount: row ? row.unread_count : 0 });
  } catch (error) {
    res.status(500).json({ message: "Okunmamış bildirim sayısı alınamadı." });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    await run(
      `
      UPDATE notifications
      SET is_read = 1
      WHERE user_id = ? AND is_read = 0
      `,
      [req.user.id]
    );

    res.json({ message: "Bildirimler okundu olarak işaretlendi." });
  } catch (error) {
    res.status(500).json({ message: "Bildirimler güncellenemedi." });
  }
});

module.exports = router;

const express = require("express");
const { all } = require("../db/database");
const { authenticateToken } = require("../middleware/auth");
const { authorizeSuperAdminOnly } = require("../utils/system-logs");

const router = express.Router();

router.use(authenticateToken, authorizeSuperAdminOnly);

router.get("/", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

    const rows = await all(
      `
      SELECT
        l.id,
        l.user_id,
        l.action,
        l.ip_address,
        l.created_at,
        u.ad,
        u.soyad,
        u.username,
        u.role
      FROM system_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ORDER BY datetime(l.created_at) DESC, l.id DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Sistem logları alınamadı." });
  }
});

module.exports = router;

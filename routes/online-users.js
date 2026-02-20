const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { listOnlineUsers } = require("../utils/online-users");

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  async (req, res) => {
    try {
      res.json({
        onlineUsers: listOnlineUsers(),
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ message: "Çevrim içi kullanıcı listesi alınamadı." });
    }
  }
);

module.exports = router;


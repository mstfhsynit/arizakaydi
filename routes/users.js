const express = require("express");
const bcrypt = require("bcrypt");
const { all, get, run } = require("../db/database");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { validateUserPayload } = require("../utils/validators");
const { extractIpAddress, logSystemAction } = require("../utils/system-logs");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("admin"));

router.get("/", async (req, res) => {
  try {
    const rows = await all(
      `
      SELECT id, ad, soyad, username, role, demo_password
      FROM users
      ORDER BY id DESC
      `
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Kullanıcılar listelenemedi." });
  }
});

router.post("/", async (req, res) => {
  try {
    const { errors, cleaned } = validateUserPayload(req.body, false);
    if (errors.length) {
      res.status(400).json({ message: errors.join(" ") });
      return;
    }

    const exists = await get("SELECT id FROM users WHERE username = ?", [cleaned.username]);
    if (exists) {
      res.status(400).json({ message: "Bu kullanıcı adı zaten kullanılıyor." });
      return;
    }

    const hashed = await bcrypt.hash(cleaned.password, 10);
    await run(
      `
      INSERT INTO users (ad, soyad, username, password, role, demo_password)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [cleaned.ad, cleaned.soyad, cleaned.username, hashed, cleaned.role, cleaned.password]
    );

    res.status(201).json({ message: "Kullanıcı oluşturuldu." });
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı oluşturulamadı." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ message: "Geçersiz kullanıcı id." });
      return;
    }

    const existing = await get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!existing) {
      res.status(404).json({ message: "Kullanıcı bulunamadı." });
      return;
    }

    const { errors, cleaned } = validateUserPayload(req.body, true);
    if (errors.length) {
      res.status(400).json({ message: errors.join(" ") });
      return;
    }

    const next = {
      ad: cleaned.ad || existing.ad,
      soyad: cleaned.soyad || existing.soyad,
      username: cleaned.username || existing.username,
      role: cleaned.role || existing.role,
      demo_password: existing.demo_password,
      password: existing.password,
    };

    if (cleaned.username && cleaned.username !== existing.username) {
      const duplicate = await get("SELECT id FROM users WHERE username = ? AND id != ?", [
        cleaned.username,
        userId,
      ]);
      if (duplicate) {
        res.status(400).json({ message: "Bu kullanıcı adı zaten kullanılıyor." });
        return;
      }
    }

    if (cleaned.password) {
      next.password = await bcrypt.hash(cleaned.password, 10);
      next.demo_password = cleaned.password;
    }

    await run(
      `
      UPDATE users
      SET ad = ?, soyad = ?, username = ?, password = ?, role = ?, demo_password = ?
      WHERE id = ?
      `,
      [
        next.ad,
        next.soyad,
        next.username,
        next.password,
        next.role,
        next.demo_password,
        userId,
      ]
    );

    if (existing.role !== next.role) {
      await logSystemAction({
        userId: req.user.id,
        action: "role_change",
        ipAddress: extractIpAddress(req),
      });
    }

    res.json({ message: "Kullanıcı güncellendi." });
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı güncellenemedi." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ message: "Geçersiz kullanıcı id." });
      return;
    }
    if (userId === req.user.id) {
      res.status(400).json({ message: "Kendi hesabınızı silemezsiniz." });
      return;
    }

    const result = await run("DELETE FROM users WHERE id = ?", [userId]);
    if (!result.changes) {
      res.status(404).json({ message: "Kullanıcı bulunamadı." });
      return;
    }
    res.json({ message: "Kullanıcı silindi." });
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı silinemedi." });
  }
});

module.exports = router;

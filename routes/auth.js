const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { get, run } = require("../db/database");
const { JWT_SECRET, authenticateToken } = require("../middleware/auth");
const { extractIpAddress, logSystemAction } = require("../utils/system-logs");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!username || !password) {
      res.status(400).json({ message: "Kullanıcı adı ve şifre zorunludur." });
      return;
    }

    const user = await get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      res.status(401).json({ message: "Kullanıcı adı veya şifre hatalı." });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ message: "Kullanıcı adı veya şifre hatalı." });
      return;
    }

    const token = jwt.sign(
      {
        id: user.id,
        ad: user.ad,
        soyad: user.soyad,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    await logSystemAction({
      userId: user.id,
      action: "login",
      ipAddress: extractIpAddress(req),
    });

    res.json({
      token,
      user: {
        id: user.id,
        ad: user.ad,
        soyad: user.soyad,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Giriş yapılırken hata oluştu." });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await get(
      "SELECT id, ad, soyad, username, role FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!user) {
      res.status(404).json({ message: "Kullanıcı bulunamadı." });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Kullanıcı bilgisi alınamadı." });
  }
});

router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const currentPassword =
      typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
    const newPasswordRepeat =
      typeof req.body.newPasswordRepeat === "string"
        ? req.body.newPasswordRepeat
        : typeof req.body.confirmPassword === "string"
        ? req.body.confirmPassword
        : "";

    if (!currentPassword || !newPassword || !newPasswordRepeat) {
      res
        .status(400)
        .json({ message: "Mevcut şifre, yeni şifre ve şifre tekrarı zorunludur." });
      return;
    }
    if (newPassword.length < 4) {
      res.status(400).json({ message: "Yeni şifre en az 4 karakter olmalıdır." });
      return;
    }
    if (newPassword !== newPasswordRepeat) {
      res.status(400).json({ message: "Yeni şifre ve şifre tekrarı aynı olmalıdır." });
      return;
    }

    const user = await get("SELECT id, password FROM users WHERE id = ?", [req.user.id]);
    if (!user) {
      res.status(404).json({ message: "Kullanıcı bulunamadı." });
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res.status(400).json({ message: "Mevcut şifre yanlış." });
      return;
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await run("UPDATE users SET password = ?, demo_password = ? WHERE id = ?", [
      hashed,
      newPassword,
      req.user.id,
    ]);

    res.json({ message: "Şifre başarıyla güncellendi." });
  } catch (error) {
    res.status(500).json({ message: "Şifre güncellenirken hata oluştu." });
  }
});

router.post("/logout", authenticateToken, async (req, res) => {
  try {
    await logSystemAction({
      userId: req.user.id,
      action: "logout",
      ipAddress: extractIpAddress(req),
    });
    res.json({ message: "Çıkış yapıldı." });
  } catch (error) {
    res.status(500).json({ message: "Çıkış yapılırken hata oluştu." });
  }
});

module.exports = router;

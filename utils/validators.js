const {
  BLOKS,
  KATEGORILER,
  ALT_KATEGORILER,
  ACILIYET,
  DURUM,
  ROLLER,
} = require("./constants");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateCreateRequest(payload = {}) {
  const errors = [];
  const adSoyad = text(payload.adSoyad);
  const blok = text(payload.blok);
  const kategori = text(payload.kategori);
  const altKategori = text(payload.alt_kategori);
  const aciliyet = text(payload.aciliyet);
  const aciklama = text(payload.aciklama);

  if (!adSoyad) {
    errors.push("Ad Soyad zorunludur.");
  }
  if (!BLOKS.includes(blok)) {
    errors.push("Geçersiz blok seçimi.");
  }
  if (!KATEGORILER.includes(kategori)) {
    errors.push("Geçersiz kategori seçimi.");
  }
  if (!ALT_KATEGORILER[kategori] || !ALT_KATEGORILER[kategori].includes(altKategori)) {
    errors.push("Geçersiz alt kategori seçimi.");
  }
  if (!ACILIYET.includes(aciliyet)) {
    errors.push("Geçersiz aciliyet seçimi.");
  }
  if ((aciliyet === "Acil" || altKategori === "Diger") && !aciklama) {
    errors.push("Acil veya Diğer seçiminde açıklama zorunludur.");
  }

  return {
    errors,
    cleaned: {
      adSoyad,
      blok,
      kategori,
      alt_kategori: altKategori,
      aciliyet,
      aciklama,
    },
  };
}

function validateStatus(status = "") {
  const value = text(status);
  if (!DURUM.includes(value)) {
    return null;
  }
  return value;
}

function validateTicketComment(comment = "") {
  const value = text(comment);
  if (!value) {
    return { error: "Yorum alanı boş bırakılamaz.", value: "" };
  }
  if (value.length > 1000) {
    return { error: "Yorum en fazla 1000 karakter olabilir.", value: "" };
  }
  return { error: "", value };
}

function validateUserPayload(payload = {}, isUpdate = false) {
  const ad = text(payload.ad);
  const soyad = text(payload.soyad);
  const username = text(payload.username);
  const password = text(payload.password);
  const passwordRepeat = text(
    payload.password_repeat || payload.passwordRepeat || payload.confirmPassword
  );
  const role = text(payload.role);
  const errors = [];

  if (!isUpdate || ad) {
    if (!ad) errors.push("Ad zorunludur.");
  }
  if (!isUpdate || soyad) {
    if (!soyad) errors.push("Soyad zorunludur.");
  }
  if (!isUpdate || username) {
    if (!username) errors.push("Kullanıcı adı zorunludur.");
  }
  if (!isUpdate || password) {
    if (!password || password.length < 4) errors.push("Şifre en az 4 karakter olmalıdır.");
    if (!passwordRepeat) errors.push("Şifre tekrarı zorunludur.");
    if (password && passwordRepeat && password !== passwordRepeat) {
      errors.push("Şifre ve şifre tekrarı aynı olmalıdır.");
    }
  }
  if (!isUpdate || role) {
    if (!ROLLER.includes(role)) errors.push("Geçersiz rol seçimi.");
  }

  return {
    errors,
    cleaned: {
      ad,
      soyad,
      username,
      password,
      password_repeat: passwordRepeat,
      role,
    },
  };
}

module.exports = {
  validateCreateRequest,
  validateStatus,
  validateTicketComment,
  validateUserPayload,
};

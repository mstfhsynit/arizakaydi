const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { randomUUID } = require("crypto");

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".jpg", ".png", ".pdf"];
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

const PROJECT_ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(PROJECT_ROOT, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const isAllowedExtension = ALLOWED_EXTENSIONS.includes(ext);
  const isAllowedMime = ALLOWED_MIME_TYPES.has(mime);

  if (!isAllowedExtension || !isAllowedMime) {
    const error = new Error("Sadece .jpg, .png ve .pdf dosyaları yüklenebilir.");
    error.code = "INVALID_FILE_TYPE";
    cb(error);
    return;
  }

  cb(null, true);
}

const attachmentUpload = multer({
  storage,
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE_BYTES,
    files: 1,
  },
  fileFilter,
}).single("attachment");

function sendUploadError(res, error) {
  if (!error) return false;

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ message: "Dosya boyutu en fazla 5MB olmalıdır." });
    return true;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({ message: "Dosya yükleme hatası." });
    return true;
  }

  if (error.code === "INVALID_FILE_TYPE") {
    res.status(400).json({ message: "Sadece .jpg, .png ve .pdf dosyaları yüklenebilir." });
    return true;
  }

  return false;
}

function toAttachmentPath(filename) {
  return `uploads/${filename}`;
}

function resolveAttachmentPath(attachmentPath) {
  if (typeof attachmentPath !== "string") return null;
  const normalized = attachmentPath.trim().replace(/\\/g, "/");
  if (!normalized || normalized === "uploads" || normalized === "uploads/") return null;
  if (!normalized.startsWith("uploads/")) return null;

  const absolutePath = path.resolve(PROJECT_ROOT, normalized);
  const relativeToUploadDir = path.relative(UPLOAD_DIR, absolutePath);
  if (
    !relativeToUploadDir ||
    relativeToUploadDir.startsWith("..") ||
    path.isAbsolute(relativeToUploadDir)
  ) {
    return null;
  }

  return absolutePath;
}

async function removeUploadedFile(file) {
  if (!file || !file.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Yüklenen dosya temizlenemedi:", error);
    }
  }
}

module.exports = {
  attachmentUpload,
  sendUploadError,
  toAttachmentPath,
  resolveAttachmentPath,
  removeUploadedFile,
};

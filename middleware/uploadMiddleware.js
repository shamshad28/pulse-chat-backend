const multer = require("multer");
const path = require("path");

const ALLOWED_MIME_TYPES = new Set([
  // Images (Excludes image/svg+xml to prevent SVG-based XSS)
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",

  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",

  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".wav",
  ".ogg",
  ".webm",
  ".m4a",
  ".aac",
  ".mp4",
  ".mov",
]);

const FORBIDDEN_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".shtml",
  ".svg",
  ".xml",
  ".php",
  ".phtml",
  ".php3",
  ".php4",
  ".php5",
  ".phps",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".bash",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".py",
  ".pyc",
  ".rb",
  ".pl",
  ".cgi",
  ".jsp",
  ".asp",
  ".aspx",
  ".dll",
  ".jar",
  ".war",
  ".htaccess",
  ".config",
  ".env",
]);

const fileFilter = (req, file, cb) => {
  const originalName = file.originalname || "";
  const ext = path.extname(originalName).toLowerCase();
  const mimeType = (file.mimetype || "").toLowerCase();

  // Reject dangerous extensions immediately
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    return cb(
      new Error(`Files with extension '${ext}' are forbidden for security reasons.`)
    );
  }

  // Verify allowed extension and mime type
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return cb(
      new Error(
        `Unsupported file type '${ext || mimeType}'. Only images (JPEG, PNG, WebP, GIF), audio, video, and standard documents (PDF, TXT, DOCX) are permitted.`
      )
    );
  }

  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit per file
    files: 5, // max 5 files per request
  },
  fileFilter,
});

module.exports = {
  upload,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
};

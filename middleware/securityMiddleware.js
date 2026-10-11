const rateLimit = require("express-rate-limit");

// Probe patterns matching typical vulnerability scanners
const SUSPICIOUS_PATHS = [
  /\.(env|git|aws|config|htaccess|svn|ds_store|bak|swp|yml|yaml)$/i,
  /\.env(\.|$)/i,
  /adminer(\.php)?/i,
  /phpmyadmin/i,
  /wp-(login|admin|config|content|includes)/i,
  /xmlrpc\.php/i,
  /eval-stdin\.php/i,
  /\.(php|asp|aspx|jsp|cgi|pl|sh|bash)$/i,
  /console(\.php)?/i,
  /actuator(\/|$)/i,
  /_profiler(\/|$)/i,
];

const SUSPICIOUS_PAYLOAD_PATTERNS = [
  /waitfor\s+delay/i,
  /pg_sleep\s*\(/i,
  /sleep\s*\(\s*\d+\s*\)/i,
  /start-sleep/i,
  /benchmark\s*\(\s*\d+/i,
  /<\?xml/i,
  /xmlns:xsl/i,
  /<xsl:stylesheet/i,
  /system\.diagnostics/i,
];

// Helper to check for malicious payload strings in objects
const containsMaliciousPayload = (val) => {
  if (typeof val === "string") {
    return SUSPICIOUS_PAYLOAD_PATTERNS.some((pattern) => pattern.test(val));
  }
  if (Array.isArray(val)) {
    return val.some((item) => containsMaliciousPayload(item));
  }
  if (val && typeof val === "object") {
    return Object.values(val).some((item) => containsMaliciousPayload(item));
  }
  return false;
};

// Middleware: Probe & Exploit Blocker
const probeBlocker = (req, res, next) => {
  const urlPath = req.path || "";
  const originalUrl = req.originalUrl || "";

  // Check path for probe targets
  const isSuspiciousPath = SUSPICIOUS_PATHS.some(
    (pattern) => pattern.test(urlPath) || pattern.test(originalUrl)
  );

  if (isSuspiciousPath) {
    console.warn(`[Security Alert] Blocked scanner probe to path: ${req.method} ${originalUrl} from IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      message: "Request blocked by security policy",
    });
  }

  // Check query parameters and body for SQLi / XSLT time-delay payloads
  if (
    containsMaliciousPayload(req.query) ||
    containsMaliciousPayload(req.body) ||
    containsMaliciousPayload(req.params)
  ) {
    console.warn(`[Security Alert] Blocked exploit probe payload in ${req.method} ${originalUrl} from IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      message: "Request blocked by security policy",
    });
  }

  next();
};

// Middleware: NoSQL Injection Sanitizer
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== "object") return;

  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
      continue;
    }
    if (typeof obj[key] === "object" && obj[key] !== null) {
      for (const subKey of Object.keys(obj[key])) {
        if (subKey.startsWith("$") || subKey.includes(".")) {
          delete obj[key][subKey];
        }
      }
      if (Object.keys(obj[key]).length === 0) {
        delete obj[key];
        continue;
      }
      sanitizeObject(obj[key]);
    }
  }
};

const mongoSanitize = (req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
};

// Middleware: Basic XSS sanitizer for text inputs
const sanitizeString = (str) => {
  if (typeof str !== "string") return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\0/g, "");
};

const xssSanitizer = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === "string") {
        req.body[key] = sanitizeString(val);
      }
    }
  }
  next();
};

// Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 150, // max 150 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down and try again shortly.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 login/register attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // max 30 upload requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Upload rate limit exceeded. Please wait a few minutes before uploading again.",
  },
});

module.exports = {
  probeBlocker,
  mongoSanitize,
  xssSanitizer,
  globalLimiter,
  authLimiter,
  uploadLimiter,
};

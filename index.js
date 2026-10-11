require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const messageRoutes = require("./routes/messageRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const registerChatSocket = require("./sockets/chatSocket");
const {
  probeBlocker,
  mongoSanitize,
  xssSanitizer,
  globalLimiter,
} = require("./middleware/securityMiddleware");

const app = express();
const server = http.createServer(app);

// 1. Scanner & Exploit Probe Blocker (Top of middleware stack)
app.use(probeBlocker);

// 2. HTTP Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        mediaSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:", "http:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 3. Strict CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  process.env.CLIENT_URL,
]
  .filter(Boolean)
  .map((url) => url.replace(/\/+$/, ""));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.replace(/\/+$/, "");
    if (
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.startsWith("http://localhost:") ||
      cleanOrigin.startsWith("http://127.0.0.1:") ||
      cleanOrigin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }
    // Disallow unauthorized origins with credentials
    return callback(new Error("CORS policy violation: origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cookie"],
};

const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

app.set("io", io);

app.use(cors(corsOptions));
// Safe 2MB body limit (file uploads use multipart memory stream)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// 4. Input Sanitization (NoSQL injection and XSS tags)
app.use(mongoSanitize);
app.use(xssSanitizer);

// 5. Rate Limiting for API routes
app.use("/api", globalLimiter);

// 6. Secure Static Uploads Directory
const uploadsDir = process.env.VERCEL ? "/tmp/uploads" : path.join(__dirname, "uploads");
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn("Notice: Uploads directory setup:", e.message);
}

app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(uploadsDir, {
    dotfiles: "deny",
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      const ext = path.extname(filePath).toLowerCase();
      const inlineExts = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".mp4",
        ".webm",
        ".mp3",
        ".wav",
        ".ogg",
      ];
      if (!inlineExts.includes(ext)) {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${path.basename(filePath)}"`
        );
      }
    },
  })
);

// 7. Sanitized Diagnostic Health Check endpoint (no host/DB name disclosure)
app.get(["/api/health", "/health"], (req, res) => {
  const readyState = mongoose.connection.readyState;
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  res.status(200).json({
    success: true,
    message: "PulseChat server is running",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: states[readyState] || "unknown",
      readyState,
      configured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI),
    },
    auth: {
      jwtConfigured: Boolean(process.env.JWT_SECRET),
    },
    environment: process.env.NODE_ENV || "development",
  });
});

// Middleware to ensure DB connection before handling API requests
app.use(async (req, res, next) => {
  if (req.path === "/health" || req.path === "/api/health" || req.path.startsWith("/uploads")) {
    return next();
  }

  try {
    await connectDB();
    next();
  } catch (err) {
    console.error(`Database error on ${req.method} ${req.path}:`, err.message);
    return res.status(503).json({
      success: false,
      message: "Database connection unavailable. Please check database configuration.",
    });
  }
});

// API Routes
app.use(["/api/auth", "/auth"], authRoutes);
app.use(["/api/users", "/users"], userRoutes);
app.use(["/api/conversations", "/conversations"], conversationRoutes);
app.use(["/api/messages", "/messages"], messageRoutes);
app.use(["/api/upload", "/upload"], uploadRoutes);

// Socket Handler
registerChatSocket(io);

// Centralized Error Handler (prevents stack trace leakage)
app.use((err, req, res, next) => {
  if (err.message && err.message.includes("CORS policy violation")) {
    return res.status(403).json({
      success: false,
      message: "Origin not permitted by CORS policy",
    });
  }

  console.error("Server error:", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 PulseChat server is running on http://0.0.0.0:${PORT}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error("Server error:", error.message);
    }
  });

  try {
    await connectDB();
  } catch (err) {
    console.error("⚠️ Initial MongoDB connection failed:", err.message);
  }
};

if (process.env.VERCEL) {
  connectDB().catch((err) =>
    console.error("Vercel cold start DB connection warning:", err.message)
  );
} else {
  startServer();
}

module.exports = app;

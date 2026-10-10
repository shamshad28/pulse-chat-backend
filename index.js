require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const http = require("http");
const cors = require("cors");
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

const app = express();
const server = http.createServer(app);

// Normalize allowed origins by stripping trailing slashes
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
    // Allow any origin with credentials for cross-origin client apps
    return callback(null, true);
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Static uploads directory (supports serverless /tmp if needed)
const uploadsDir = process.env.VERCEL ? "/tmp/uploads" : path.join(__dirname, "uploads");
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn("Notice: Uploads directory setup:", e.message);
}
app.use("/uploads", express.static(uploadsDir));

// Diagnostic Health Check endpoint
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
      host: mongoose.connection.host || null,
      name: mongoose.connection.name || null,
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
      message: "Database connection unavailable. Please check MONGO_URI and MongoDB Atlas network access (0.0.0.0/0).",
      error: err.message,
    });
  }
});

// API Routes
app.use(["/api/auth", "/auth"], authRoutes);
app.use(["/api/users", "/users"], userRoutes);
app.use(["/api/conversations", "/conversations"], conversationRoutes);
app.use(["/api/messages", "/messages"], messageRoutes);
app.use(["/api/upload", "/upload"], uploadRoutes);

registerChatSocket(io);

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
  // Bind to 0.0.0.0 so cloud providers (Render, Railway, Fly.io, Heroku) can route traffic
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 PulseChat server is running on http://0.0.0.0:${PORT}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Please stop the other process on port ${PORT}.`
      );
    } else {
      console.error("Server error:", error.message);
    }
  });

  // Attempt initial DB connection without crashing the server if delayed
  try {
    await connectDB();
  } catch (err) {
    console.error(
      "⚠️ Initial MongoDB connection failed. Server will keep running and retry on incoming requests:",
      err.message
    );
  }
};

if (process.env.VERCEL) {
  // In Vercel serverless, initiate background connection on cold start
  connectDB().catch((err) => console.error("Vercel cold start DB connection warning:", err.message));
} else {
  startServer();
}

module.exports = app;


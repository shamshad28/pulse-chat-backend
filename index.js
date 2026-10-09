require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const path = require("path");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const messageRoutes = require("./routes/messageRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const registerChatSocket = require("./sockets/chatSocket");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get(["/api/health", "/health"], (req, res) => {
  res.status(200).json({ success: true, message: "Server is running" });
});

app.use(["/api/auth", "/auth"], authRoutes);
app.use(["/api/users", "/users"], userRoutes);
app.use(["/api/conversations", "/conversations"], conversationRoutes);
app.use(["/api/messages", "/messages"], messageRoutes);
app.use(["/api/upload", "/upload"], uploadRoutes);

registerChatSocket(io);

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    server.on("error", async (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Please stop the other process on port ${PORT}.`
        );
      } else {
        console.error("Server error:", error.message);
      }
      await mongoose.disconnect().catch(() => { });
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    await mongoose.disconnect().catch(() => { });
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  }
};

if (process.env.VERCEL) {
  // Connect to DB asynchronously on Vercel serverless startup
  connectDB().catch((err) => console.error("Vercel DB connection error:", err.message));
} else {
  startServer();
}

module.exports = app;


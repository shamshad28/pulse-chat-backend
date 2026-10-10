const mongoose = require("mongoose");

let connectionPromise = null;

const connectDB = async () => {
  // If already connected, return existing connection
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If currently connecting, await the active promise to avoid duplicate connections
  if (mongoose.connection.readyState === 2 && connectionPromise) {
    return connectionPromise;
  }

  // Support both MONGO_URI and MONGODB_URI (standard across Render, Railway, Vercel, Heroku)
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    const errorMsg =
      "CRITICAL: Neither MONGO_URI nor MONGODB_URI is set. Please set your MongoDB connection string in your environment variables.";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    connectionPromise = mongoose.connect(mongoUri, {
      dbName: process.env.DB_NAME || "pulsechat",
      serverSelectionTimeoutMS: 8000,
    });

    const conn = await connectionPromise;
    console.log(
      `✅ MongoDB connected successfully to host: ${conn.connection.host} (DB: ${conn.connection.name})`
    );
    return conn;
  } catch (err) {
    connectionPromise = null;
    console.error("❌ MongoDB connection error:", err.message);

    if (
      err.name === "MongooseServerSelectionError" ||
      err.message?.includes("timed out") ||
      err.message?.includes("whitelist")
    ) {
      console.error(
        "💡 DEPLOYMENT TIP: If deploying on a cloud host (Render, Railway, Vercel, AWS), ensure you added '0.0.0.0/0' (Allow access from anywhere) in MongoDB Atlas -> Security -> Network Access."
      );
    }

    throw err;
  }
};

// Auto-reset promise when disconnected so next request can trigger reconnect
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Automatic reconnect will be attempted on next request.");
  connectionPromise = null;
});

mongoose.connection.on("error", (err) => {
  console.error("⚠️ MongoDB runtime connection error:", err.message);
});

module.exports = connectDB;
const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState >= 1) {
    return;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("WARNING: MONGO_URI is not set. Please configure MONGO_URI in your environment variables.");
    return;
  }

  try {
    const connection = await mongoose.connect(mongoUri);
    isConnected = true;
    console.log(`MongoDB connected: ${connection.connection.host}`);
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    if (!process.env.VERCEL) {
      throw err;
    }
  }
};

module.exports = connectDB;
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const generateToken = require("../utils/generateToken");

// REGISTER
const register = async (req, res) => {
  try {
    const rawName = req.body.name;
    const rawUsername = req.body.username;
    const rawEmail = req.body.email;
    const password = req.body.password;

    const name = typeof rawName === "string" ? rawName.trim() : "";
    const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

    // Validation
    if (!name || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (name.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name must be at least 2 characters",
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 3 characters",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Check existing email (case-insensitive)
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "Email already registered. Please sign in or use another email.",
      });
    }

    // Check existing username (case-insensitive)
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: "Username already taken. Please choose another username.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
    });

    // Generate JWT
    const token = generateToken(user._id);

    // Store JWT in HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        status: user.status || "online",
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error.code === 11000) {
      const isEmail = error.message?.includes("email") || error.keyPattern?.email;
      const isUsername = error.message?.includes("username") || error.keyPattern?.username;
      const field = isEmail ? "Email already registered" : isUsername ? "Username already taken" : "An account with these details already exists";
      return res.status(409).json({
        success: false,
        message: field,
      });
    }

    if (error.name === "ValidationError") {
      const msg = Object.values(error.errors || {})[0]?.message || "Validation failed";
      return res.status(400).json({
        success: false,
        message: msg,
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Registration failed due to server error",
    });
  }
};

// LOGIN
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Explicitly select password
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Compare password
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Update status
    user.status = "online";
    user.lastSeen = null;

    await user.save();

    // Generate JWT
    const token = generateToken(user._id);

    // Cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// LOGOUT
const logout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  register,
  login,
  logout,
};
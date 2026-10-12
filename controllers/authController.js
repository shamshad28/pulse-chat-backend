const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { generateToken } = require("../utils/jwt");

// REGISTER
const register = async (req, res) => {
  try {
    const rawName = req.body.name;
    const rawUsername = req.body.username;
    const rawEmail = req.body.email;
    const rawPassword = req.body.password;

    if (
      typeof rawName !== "string" ||
      typeof rawUsername !== "string" ||
      typeof rawEmail !== "string" ||
      typeof rawPassword !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid field format. All fields must be strings.",
      });
    }

    const name = rawName.trim();
    const username = rawUsername.trim().toLowerCase();
    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    // Validation
    if (!name || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Full name must be between 2 and 50 characters",
      });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        success: false,
        message: "Username must be between 3 and 30 characters",
      });
    }

    const usernameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        message: "Username can only contain letters, numbers, dots, underscores, and hyphens",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 100) {
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

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password is too long (maximum 128 characters)",
      });
    }

    // Check existing email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "Email already registered. Please sign in or use another email.",
      });
    }

    // Check existing username
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: "Username already taken. Please choose another username.",
      });
    }

    // Hash password with optimal OWASP rounds (10) for high-concurrency throughput
    const hashedPassword = await bcrypt.hash(password, 10);

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
      message: "Registration failed due to server error",
    });
  }
};

// LOGIN
const login = async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawPassword = req.body.password;

    if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email and password must be valid strings",
      });
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password exceeds maximum permitted length",
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
    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Fast atomic status update (bypasses full document validation overhead)
    User.updateOne({ _id: user._id }, { status: "online", lastSeen: null }).catch((err) =>
      console.warn("Login status update error:", err.message)
    );

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
      message: "Server error during authentication",
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
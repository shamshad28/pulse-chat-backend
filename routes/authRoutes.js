const express = require("express");

const {
  register,
  login,
  logout,
} = require("../controllers/authController");

const protect = require("../middleware/authMiddleware");
const User = require("../models/User");

const router = express.Router();

// Register
router.post("/register", register);

// Login
router.post("/login", login);

// Logout
router.post("/logout", logout);

// Current user
router.get("/me", protect, async (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      _id: req.user._id,
      name: req.user.name,
      username: req.user.username,
      email: req.user.email,
      avatar: req.user.avatar,
      status: req.user.status,
      lastSeen: req.user.lastSeen,
    },
  });
});

module.exports = router;
const express = require("express");
const {
  register,
  login,
  logout,
} = require("../controllers/authController");
const protect = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/securityMiddleware");

const router = express.Router();

// Register with rate limiter
router.post("/register", authLimiter, register);

// Login with rate limiter
router.post("/login", authLimiter, login);

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
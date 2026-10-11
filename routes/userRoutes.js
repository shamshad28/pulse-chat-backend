const express = require("express");
const {
  searchUsers,
  getUsers,
  getMe,
  updateProfile,
  getUserById,
} = require("../controllers/userController");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/me", getMe);
router.get("/search", searchUsers);
router.get("/", getUsers);
router.put("/profile", updateProfile);
router.get("/:userId", getUserById);

module.exports = router;

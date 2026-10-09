const express = require("express");
const {
  searchUsers,
  getUsers,
  updateProfile,
  getUserById,
} = require("../controllers/userController");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/search", searchUsers);
router.get("/", getUsers);
router.put("/profile", updateProfile);
router.get("/:userId", getUserById);

module.exports = router;

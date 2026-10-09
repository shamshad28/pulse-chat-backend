const express = require("express");
const {
  sendMessage,
  getMessages,
  toggleReaction,
  markConversationAsRead,
  searchMessages,
} = require("../controllers/messageController");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/search", searchMessages);
router.post("/", sendMessage);
router.get("/:conversationId", getMessages);
router.put("/:conversationId/read", markConversationAsRead);
router.post("/:messageId/reactions", toggleReaction);

module.exports = router;

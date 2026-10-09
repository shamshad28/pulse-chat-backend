const express = require("express");
const {
  createDirectConversation,
  createGroupConversation,
  getMyConversations,
  getConversationById,
  addGroupMembers,
  removeGroupMember,
  toggleAdminRole,
  updateGroupSettings,
} = require("../controllers/conversationController");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.post("/direct", createDirectConversation);
router.post("/group", createGroupConversation);
router.get("/", getMyConversations);
router.get("/:conversationId", getConversationById);
router.put("/:conversationId", updateGroupSettings);
router.post("/:conversationId/members", addGroupMembers);
router.delete("/:conversationId/members/:userId", removeGroupMember);
router.put("/:conversationId/admins", toggleAdminRole);

module.exports = router;
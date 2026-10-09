const Conversation = require("../models/Conversation");
const User = require("../models/User");
const Message = require("../models/Message");

// Create or find a direct conversation
const createDirectConversation = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    if (req.user._id.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot create a conversation with yourself",
      });
    }

    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if conversation already exists
    const existingConversation = await Conversation.findOne({
      type: "direct",
      members: {
        $all: [req.user._id, userId],
        $size: 2,
      },
    })
      .populate("members", "name username email avatar status lastSeen")
      .populate("lastMessage");

    if (existingConversation) {
      return res.status(200).json({
        success: true,
        message: "Conversation already exists",
        conversation: existingConversation,
      });
    }

    // Create new conversation
    const conversation = await Conversation.create({
      type: "direct",
      members: [req.user._id, userId],
      createdBy: req.user._id,
    });

    const populatedConversation = await Conversation.findById(conversation._id)
      .populate("members", "name username email avatar status lastSeen")
      .populate("createdBy", "name username avatar");

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${userId}`).emit("conversation:new", populatedConversation);
    }

    res.status(201).json({
      success: true,
      message: "Conversation created successfully",
      conversation: populatedConversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Create a group conversation
const createGroupConversation = async (req, res) => {
  try {
    const { name, members = [], avatar = "" } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    const memberSet = new Set(members.map((id) => id.toString()));
    memberSet.add(req.user._id.toString());

    if (memberSet.size < 2) {
      return res.status(400).json({
        success: false,
        message: "A group must have at least 2 members",
      });
    }

    const group = await Conversation.create({
      type: "group",
      name: name.trim(),
      avatar: avatar.trim(),
      members: Array.from(memberSet),
      admins: [req.user._id],
      createdBy: req.user._id,
    });

    const populatedGroup = await Conversation.findById(group._id)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar");

    const io = req.app.get("io");
    if (io) {
      memberSet.forEach((memberId) => {
        io.to(`user:${memberId}`).emit("conversation:new", populatedGroup);
      });
    }

    res.status(201).json({
      success: true,
      message: "Group created successfully",
      conversation: populatedGroup,
    });
  } catch (error) {
    console.error("Create group error:", error);
    res.status(500).json({
      success: false,
      message: "Server error creating group",
    });
  }
};

// Get all conversations of logged-in user
const getMyConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      members: req.user._id,
    })
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name username avatar",
        },
      })
      .sort({ updatedAt: -1 });

    const conversationIds = conversations.map((c) => c._id);

    // Calculate actual unread message count for current user
    const unreadAgg = await Message.aggregate([
      {
        $match: {
          conversation: { $in: conversationIds },
          sender: { $ne: req.user._id },
          readBy: { $ne: req.user._id },
        },
      },
      {
        $group: {
          _id: "$conversation",
          count: { $sum: 1 },
        },
      },
    ]);

    const unreadMap = {};
    unreadAgg.forEach((item) => {
      unreadMap[item._id.toString()] = item.count;
    });

    const conversationsWithUnread = conversations.map((c) => {
      const obj = c.toObject();
      obj.unreadCount = unreadMap[c._id.toString()] || 0;
      return obj;
    });

    res.status(200).json({
      success: true,
      count: conversationsWithUnread.length,
      conversations: conversationsWithUnread,
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get one conversation
const getConversationById = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name username avatar",
        },
      });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isMember = conversation.members.some(
      (member) => member._id.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Add members to group (Admin only)
const addGroupMembers = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { members = [] } = req.body;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({
        success: false,
        message: "Group conversation not found",
      });
    }

    const isAdmin = conversation.admins.some(
      (adminId) => adminId.toString() === req.user._id.toString()
    );

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can add members",
      });
    }

    const currentMemberIds = new Set(
      conversation.members.map((m) => m.toString())
    );
    const newMembers = members.filter((id) => !currentMemberIds.has(id.toString()));

    if (newMembers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Selected users are already members of this group",
      });
    }

    conversation.members.push(...newMembers);
    await conversation.save();

    const updatedGroup = await Conversation.findById(conversationId)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "name username avatar" },
      });

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("group:updated", updatedGroup);
      newMembers.forEach((memberId) => {
        io.to(`user:${memberId}`).emit("conversation:new", updatedGroup);
      });
    }

    res.status(200).json({
      success: true,
      message: "Members added successfully",
      conversation: updatedGroup,
    });
  } catch (error) {
    console.error("Add group members error:", error);
    res.status(500).json({
      success: false,
      message: "Server error adding members",
    });
  }
};

// Remove member from group (Admin can remove anyone, or user can leave)
const removeGroupMember = async (req, res) => {
  try {
    const { conversationId, userId } = req.params;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({
        success: false,
        message: "Group conversation not found",
      });
    }

    const isSelf = req.user._id.toString() === userId.toString();
    const isAdmin = conversation.admins.some(
      (adminId) => adminId.toString() === req.user._id.toString()
    );

    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can remove other members",
      });
    }

    // Filter out member
    conversation.members = conversation.members.filter(
      (m) => m.toString() !== userId.toString()
    );
    conversation.admins = conversation.admins.filter(
      (a) => a.toString() !== userId.toString()
    );

    // If no admins remain and there are still members, make the first member admin
    if (conversation.admins.length === 0 && conversation.members.length > 0) {
      conversation.admins.push(conversation.members[0]);
    }

    await conversation.save();

    const updatedGroup = await Conversation.findById(conversationId)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "name username avatar" },
      });

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("group:updated", updatedGroup);
      io.to(`user:${userId}`).emit("group:removed", { conversationId });
    }

    res.status(200).json({
      success: true,
      message: isSelf ? "Left group successfully" : "Member removed successfully",
      conversation: updatedGroup,
    });
  } catch (error) {
    console.error("Remove group member error:", error);
    res.status(500).json({
      success: false,
      message: "Server error removing member",
    });
  }
};

// Promote / Demote admin (Admin only)
const toggleAdminRole = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId, role } = req.body; // role: 'admin' or 'member'

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({
        success: false,
        message: "Group conversation not found",
      });
    }

    const isRequesterAdmin = conversation.admins.some(
      (adminId) => adminId.toString() === req.user._id.toString()
    );

    if (!isRequesterAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can assign admin permissions",
      });
    }

    const isTargetMember = conversation.members.some(
      (m) => m.toString() === userId.toString()
    );

    if (!isTargetMember) {
      return res.status(400).json({
        success: false,
        message: "User is not a member of this group",
      });
    }

    if (role === "admin") {
      if (!conversation.admins.some((a) => a.toString() === userId.toString())) {
        conversation.admins.push(userId);
      }
    } else {
      if (
        conversation.admins.length === 1 &&
        conversation.admins[0].toString() === userId.toString()
      ) {
        return res.status(400).json({
          success: false,
          message: "Group must have at least one admin",
        });
      }
      conversation.admins = conversation.admins.filter(
        (a) => a.toString() !== userId.toString()
      );
    }

    await conversation.save();

    const updatedGroup = await Conversation.findById(conversationId)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar");

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("group:updated", updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: "Admin role updated successfully",
      conversation: updatedGroup,
    });
  } catch (error) {
    console.error("Toggle admin role error:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating admin role",
    });
  }
};

// Update group settings (name, avatar)
const updateGroupSettings = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { name, avatar } = req.body;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({
        success: false,
        message: "Group conversation not found",
      });
    }

    const isAdmin = conversation.admins.some(
      (adminId) => adminId.toString() === req.user._id.toString()
    );

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can update group settings",
      });
    }

    if (typeof name === "string" && name.trim()) {
      conversation.name = name.trim();
    }
    if (typeof avatar === "string") {
      conversation.avatar = avatar.trim();
    }

    await conversation.save();

    const updatedGroup = await Conversation.findById(conversationId)
      .populate("members", "name username email avatar status lastSeen")
      .populate("admins", "name username email avatar")
      .populate("createdBy", "name username avatar");

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("group:updated", updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: "Group updated successfully",
      conversation: updatedGroup,
    });
  } catch (error) {
    console.error("Update group settings error:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating group settings",
    });
  }
};

// Delete entire conversation and all its messages
const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isMember = conversation.members.some(
      (m) => m.toString() === req.user._id.toString()
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    const memberIds = [...conversation.members];

    // Delete all messages in the conversation
    await Message.deleteMany({ conversation: conversationId });

    // Delete the conversation document
    await Conversation.findByIdAndDelete(conversationId);

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("conversation:deleted", {
        conversationId,
      });
      memberIds.forEach((mId) => {
        io.to(`user:${mId.toString()}`).emit("conversation:deleted", {
          conversationId,
        });
      });
    }

    res.status(200).json({
      success: true,
      message: "Conversation and all messages deleted successfully",
      conversationId,
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error deleting conversation",
    });
  }
};

// Clear all messages in conversation without deleting conversation
const clearConversationMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isMember = conversation.members.some(
      (m) => m.toString() === req.user._id.toString()
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    await Message.deleteMany({ conversation: conversationId });
    conversation.lastMessage = null;
    await conversation.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("conversation:cleared", {
        conversationId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Chat messages cleared successfully",
      conversationId,
    });
  } catch (error) {
    console.error("Clear chat error:", error);
    res.status(500).json({
      success: false,
      message: "Server error clearing chat",
    });
  }
};

module.exports = {
  createDirectConversation,
  createGroupConversation,
  getMyConversations,
  getConversationById,
  addGroupMembers,
  removeGroupMember,
  toggleAdminRole,
  updateGroupSettings,
  deleteConversation,
  clearConversationMessages,
};
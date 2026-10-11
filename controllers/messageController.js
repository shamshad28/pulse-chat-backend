const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// Helper to escape regex special characters to prevent ReDoS
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Helper to validate safe media URL
const isSafeMediaUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("/uploads/")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const {
      conversationId: rawConvId,
      conversation: altConvId,
      content,
      type = "text",
      attachments = [],
      replyTo = null,
    } = req.body;

    const conversationId = rawConvId || altConvId;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Valid conversationId is required",
      });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isMember = conversation.members.some(
      (member) => member.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    const trimmedContent = typeof content === "string" ? content.trim().slice(0, 10000) : "";

    // Validate attachments
    const safeAttachments = [];
    if (Array.isArray(attachments)) {
      for (const att of attachments.slice(0, 10)) {
        if (att && typeof att === "object" && isSafeMediaUrl(att.url)) {
          safeAttachments.push({
            url: att.url.trim(),
            publicId: typeof att.publicId === "string" ? att.publicId.slice(0, 200) : "",
            fileName: typeof att.fileName === "string" ? att.fileName.slice(0, 150) : "attachment",
            mimeType: typeof att.mimeType === "string" ? att.mimeType.slice(0, 100) : "application/octet-stream",
            size: Number(att.size) || 0,
            type: typeof att.type === "string" ? att.type.slice(0, 20) : "document",
          });
        }
      }
    }

    if (!trimmedContent && safeAttachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message content or valid attachment is required",
      });
    }

    // Verify replyTo if provided
    let validReplyTo = null;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      const parentMessage = await Message.findById(replyTo);
      if (parentMessage && parentMessage.conversation.toString() === conversationId) {
        validReplyTo = parentMessage._id;
      }
    }

    // Initialize readBy with sender
    const readBy = [req.user._id];
    const deliveredTo = [req.user._id];

    // Check which other members are currently online
    const io = req.app.get("io");
    if (io && io.onlineUsers) {
      conversation.members.forEach((memberId) => {
        const idStr = memberId.toString();
        if (idStr !== req.user._id.toString() && io.onlineUsers.has(idStr)) {
          deliveredTo.push(memberId);
        }
      });
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      content: trimmedContent,
      type: typeof type === "string" ? type.slice(0, 20) : "text",
      attachments: safeAttachments,
      replyTo: validReplyTo,
      readBy,
      deliveredTo,
      reactions: [],
    });

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "name username avatar")
      .populate({
        path: "replyTo",
        select: "content sender type attachments createdAt",
        populate: {
          path: "sender",
          select: "name username avatar",
        },
      });

    conversation.lastMessage = message._id;
    await conversation.save();

    if (io) {
      // Broadcast to active room
      io.to(`conversation:${conversationId}`).emit("newMessage", populatedMessage);

      // Broadcast notifications to each conversation member's personal room
      conversation.members.forEach((memberId) => {
        const idStr = memberId.toString();
        if (idStr !== req.user._id.toString()) {
          io.to(`user:${idStr}`).emit("messageNotification", {
            conversationId,
            message: populatedMessage,
            conversationType: conversation.type,
            conversationName:
              conversation.type === "group" ? conversation.name : req.user.name,
          });
        }
      });
    }

    res.status(201).json({
      success: true,
      data: populatedMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Server error sending message",
    });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 30), 100);
    const before = req.query.before;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isMember = conversation.members.some(
      (member) => member.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    const query = { conversation: conversationId };
    if (before && !isNaN(new Date(before).getTime())) {
      query.createdAt = { $lt: new Date(before) };
    }

    const total = await Message.countDocuments({ conversation: conversationId });
    const skip = before ? 0 : (page - 1) * limit;

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "name username avatar")
      .populate({
        path: "replyTo",
        select: "content sender type attachments createdAt",
        populate: {
          path: "sender",
          select: "name username avatar",
        },
      })
      .lean();

    // Mark messages as delivered to this user
    await Message.updateMany(
      {
        conversation: conversationId,
        deliveredTo: { $ne: req.user._id },
      },
      {
        $addToSet: { deliveredTo: req.user._id },
      }
    );

    const chronologicalMessages = messages.reverse();

    res.status(200).json({
      success: true,
      messages: chronologicalMessages,
      page,
      total,
      hasMore: total > skip + messages.length,
      nextCursor: chronologicalMessages.length > 0 ? chronologicalMessages[0].createdAt : null,
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching messages",
    });
  }
};

// Toggle emoji reaction
const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    if (!emoji || typeof emoji !== "string" || emoji.trim().length > 16) {
      return res.status(400).json({
        success: false,
        message: "Valid emoji string is required (max 16 characters)",
      });
    }

    const cleanEmoji = emoji.trim();

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const conversation = await Conversation.findById(message.conversation);
    const isMember = conversation?.members.some(
      (m) => m.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    const existingIndex = message.reactions.findIndex(
      (r) =>
        r.user.toString() === req.user._id.toString() &&
        r.emoji === cleanEmoji
    );

    if (existingIndex > -1) {
      message.reactions.splice(existingIndex, 1);
    } else {
      message.reactions.push({
        user: req.user._id,
        emoji: cleanEmoji,
      });
    }

    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("reactions.user", "name username avatar")
      .select("reactions conversation");

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${message.conversation}`).emit("messageReactionUpdated", {
        messageId: message._id,
        conversationId: message.conversation,
        reactions: populatedMessage.reactions,
      });
    }

    res.status(200).json({
      success: true,
      reactions: populatedMessage.reactions,
    });
  } catch (error) {
    console.error("Toggle reaction error:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating reaction",
    });
  }
};

// Mark all unread messages in conversation as read
const markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

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

    const updateResult = await Message.updateMany(
      {
        conversation: conversationId,
        readBy: { $ne: req.user._id },
      },
      {
        $addToSet: {
          readBy: req.user._id,
          deliveredTo: req.user._id,
        },
      }
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("messagesRead", {
        conversationId,
        userId: req.user._id,
      });
    }

    res.status(200).json({
      success: true,
      modifiedCount: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({
      success: false,
      message: "Server error marking messages as read",
    });
  }
};

// Full-text search across messages
const searchMessages = async (req, res) => {
  try {
    const { q, conversationId } = req.query;
    const rawQuery = typeof q === "string" ? q.trim() : "";

    if (!rawQuery) {
      return res.status(400).json({
        success: false,
        message: "Search query 'q' is required",
      });
    }

    // Sanitize and limit query length to prevent ReDoS
    const sanitizedQuery = escapeRegExp(rawQuery.slice(0, 50));

    // Find all conversations the user is a member of
    const userConversations = await Conversation.find({
      members: req.user._id,
    }).select("_id");

    const userConvIds = userConversations.map((c) => c._id);

    const filter = {
      conversation: { $in: userConvIds },
      content: { $regex: sanitizedQuery, $options: "i" },
    };

    if (
      conversationId &&
      mongoose.Types.ObjectId.isValid(conversationId) &&
      userConvIds.some((id) => id.toString() === conversationId)
    ) {
      filter.conversation = conversationId;
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("sender", "name username avatar")
      .populate("conversation", "name type members")
      .lean();

    res.status(200).json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Search messages error:", error);
    res.status(500).json({
      success: false,
      message: "Server error searching messages",
    });
  }
};

// Delete a single message
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const conversation = await Conversation.findById(message.conversation);
    const isSender = message.sender.toString() === req.user._id.toString();
    const isGroupAdmin =
      conversation?.type === "group" &&
      conversation?.admins?.some((a) => a.toString() === req.user._id.toString());
    const isPlatformAdmin = req.user.role === "admin";

    if (!isSender && !isGroupAdmin && !isPlatformAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    const conversationId = message.conversation.toString();
    await Message.findByIdAndDelete(messageId);

    // If deleted message was lastMessage, update conversation
    if (conversation && conversation.lastMessage?.toString() === messageId.toString()) {
      const latestMsg = await Message.findOne({ conversation: conversationId }).sort({
        createdAt: -1,
      });
      conversation.lastMessage = latestMsg?._id || null;
      await conversation.save();
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversationId}`).emit("message:deleted", {
        messageId,
        conversationId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      messageId,
      conversationId,
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      message: "Server error deleting message",
    });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  toggleReaction,
  markConversationAsRead,
  searchMessages,
  deleteMessage,
};

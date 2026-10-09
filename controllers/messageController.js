const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

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

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "conversationId is required",
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

    const trimmedContent = typeof content === "string" ? content.trim() : "";

    if (!trimmedContent && (!attachments || attachments.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Message content or attachment is required",
      });
    }

    // Verify replyTo if provided
    let validReplyTo = null;
    if (replyTo) {
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
      type,
      attachments,
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

// Get messages for a conversation with pagination / infinite scroll
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const before = req.query.before; // Optional ISO timestamp or ObjectId for cursor pagination

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
    if (before) {
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

    // Sort ascending for chat UI display
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

    if (!emoji || typeof emoji !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid emoji string is required",
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
    const isMember = conversation?.members.some(
      (m) => m.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation",
      });
    }

    // Check existing reaction by this user with this emoji
    const existingIndex = message.reactions.findIndex(
      (r) =>
        r.user.toString() === req.user._id.toString() &&
        r.emoji === emoji.trim()
    );

    if (existingIndex > -1) {
      // Remove reaction
      message.reactions.splice(existingIndex, 1);
    } else {
      // Add reaction
      message.reactions.push({
        user: req.user._id,
        emoji: emoji.trim(),
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
    const queryStr = typeof q === "string" ? q.trim() : "";

    if (!queryStr) {
      return res.status(400).json({
        success: false,
        message: "Search query 'q' is required",
      });
    }

    // Find all conversations the user is a member of
    const userConversations = await Conversation.find({
      members: req.user._id,
    }).select("_id name type");

    const userConvIds = userConversations.map((c) => c._id);

    const filter = {
      conversation: { $in: userConvIds },
      content: { $regex: queryStr, $options: "i" },
    };

    if (conversationId && userConvIds.some((id) => id.toString() === conversationId)) {
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

module.exports = {
  sendMessage,
  getMessages,
  toggleReaction,
  markConversationAsRead,
  searchMessages,
};

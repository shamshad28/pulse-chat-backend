const mongoose = require("mongoose");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { verifyToken } = require("../utils/jwt");

// Map: userId -> Set of socket IDs
const onlineUsers = new Map();
// Map: socketId -> userId
const socketUserMap = new Map();

// Helper to parse cookies from cookie header
const parseCookies = (cookieHeader) => {
  if (!cookieHeader || typeof cookieHeader !== "string") return {};
  return cookieHeader.split(";").reduce((acc, str) => {
    const parts = str.trim().split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      acc[key] = decodeURIComponent(val);
    }
    return acc;
  }, {});
};

const registerChatSocket = (io) => {
  // Attach onlineUsers to io instance so controllers can access it
  io.onlineUsers = onlineUsers;

  // 1. Socket.IO Authentication Middleware
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;

      if (!token && socket.handshake.headers?.authorization?.startsWith("Bearer ")) {
        token = socket.handshake.headers.authorization.split(" ")[1];
      }

      if (!token && socket.handshake.headers?.cookie) {
        const cookies = parseCookies(socket.handshake.headers.cookie);
        token = cookies.token;
      }

      if (!token) {
        return next(new Error("Authentication error: Token required"));
      }

      const decoded = verifyToken(token);
      if (!decoded || !decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
        return next(new Error("Authentication error: Invalid token"));
      }

      const user = await User.findById(decoded.userId).select("_id name username avatar status");
      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      socket.user = user;
      next();
    } catch (err) {
      console.warn("Socket connection rejected:", err.message);
      return next(new Error("Authentication error: Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user._id.toString();

    // Bind socket to authenticated user
    socketUserMap.set(socket.id, userId);

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Securely join private room for this verified user
    socket.join(`user:${userId}`);

    try {
      // Update user status in DB
      await User.findByIdAndUpdate(userId, {
        status: "online",
        lastSeen: null,
      });

      // Broadcast to all clients that this user is online
      io.emit("presence:update", {
        userId,
        status: "online",
        lastSeen: null,
      });

      // Send back list of all currently online users
      socket.emit("onlineUsers:list", Array.from(onlineUsers.keys()));
    } catch (err) {
      console.error("Error setting user online:", err.message);
    }

    // 2. Client setup event (acknowledgement)
    socket.on("setup", () => {
      socket.emit("onlineUsers:list", Array.from(onlineUsers.keys()));
    });

    // 3. Request current online users list
    socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers:list", Array.from(onlineUsers.keys()));
    });

    // 4. Conversation Rooms (Authorization Enforced!)
    socket.on("joinConversation", async (conversationId) => {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;

      try {
        const conversation = await Conversation.findById(conversationId).select("members");
        if (!conversation) return;

        const isMember = conversation.members.some(
          (m) => m.toString() === userId
        );

        if (!isMember) {
          socket.emit("conversation:unauthorized", {
            conversationId,
            message: "You are not a member of this conversation",
          });
          return;
        }

        socket.join(`conversation:${conversationId}`);
      } catch (err) {
        console.error("Error in joinConversation:", err.message);
      }
    });

    socket.on("leaveConversation", (conversationId) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
    });

    // 5. Typing Indicators (Restricted to members)
    socket.on("typing:start", async ({ conversationId }) => {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;

      try {
        const conversation = await Conversation.findById(conversationId).select("members");
        if (!conversation?.members.some((m) => m.toString() === userId)) return;

        socket.to(`conversation:${conversationId}`).emit("typing:started", {
          conversationId,
          user: {
            _id: socket.user._id,
            name: socket.user.name,
            username: socket.user.username,
          },
        });
      } catch (err) {
        console.error("Error in typing:start:", err.message);
      }
    });

    socket.on("typing:stop", ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("typing:stopped", {
        conversationId,
        userId,
      });
    });

    // 6. Read Receipts (Enforcing authenticated userId)
    socket.on("markAsRead", async ({ conversationId }) => {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;

      try {
        const conversation = await Conversation.findById(conversationId).select("members");
        if (!conversation?.members.some((m) => m.toString() === userId)) return;

        await Message.updateMany(
          {
            conversation: conversationId,
            readBy: { $ne: socket.user._id },
          },
          {
            $addToSet: {
              readBy: socket.user._id,
              deliveredTo: socket.user._id,
            },
          }
        );

        io.to(`conversation:${conversationId}`).emit("messagesRead", {
          conversationId,
          userId,
        });
      } catch (err) {
        console.error("Error in markAsRead socket:", err.message);
      }
    });

    // 7. WebRTC Video & Audio Calling (Enforcing verified caller ID)
    socket.on("call:initiate", ({ recipientId, conversationId, isVideo, isGroup }) => {
      const payload = {
        caller: {
          _id: socket.user._id,
          id: socket.user._id,
          name: socket.user.name,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        conversationId,
        isVideo: !!isVideo,
        isGroup: !!isGroup,
      };

      if (isGroup && conversationId) {
        socket.to(`conversation:${conversationId}`).emit("call:incoming", payload);
      } else if (recipientId) {
        io.to(`user:${recipientId}`).emit("call:incoming", payload);
      }
    });

    socket.on("call:accept", ({ callerId, conversationId, isVideo }) => {
      if (!callerId) return;
      io.to(`user:${callerId}`).emit("call:accepted", {
        recipient: {
          _id: socket.user._id,
          name: socket.user.name,
          avatar: socket.user.avatar,
        },
        conversationId,
        isVideo: !!isVideo,
      });
    });

    socket.on("call:signal", ({ targetUserId, signal, type }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit("call:signal", {
        senderId: userId,
        signal,
        type,
      });
    });

    socket.on("call:decline", ({ callerId, reason }) => {
      if (!callerId) return;
      io.to(`user:${callerId}`).emit("call:declined", {
        reason: reason || "User declined the call",
      });
    });

    socket.on("call:end", ({ targetUserId, conversationId }) => {
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit("call:ended", { fromUserId: userId });
      }
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit("call:ended", { fromUserId: userId });
      }
    });

    socket.on("call:toggle-media", ({ targetUserId, isMuted, isVideoOff }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit("call:media-toggled", {
        isMuted,
        isVideoOff,
      });
    });

    // 8. Handle Disconnect
    socket.on("disconnect", async () => {
      socketUserMap.delete(socket.id);

      if (onlineUsers.has(userId)) {
        const userSockets = onlineUsers.get(userId);
        userSockets.delete(socket.id);

        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          const now = new Date();

          try {
            await User.findByIdAndUpdate(userId, {
              status: "offline",
              lastSeen: now,
            });

            io.emit("presence:update", {
              userId,
              status: "offline",
              lastSeen: now,
            });
          } catch (err) {
            console.error("Error setting user offline:", err.message);
          }
        }
      }
    });
  });
};

module.exports = registerChatSocket;
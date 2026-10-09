const User = require("../models/User");
const Message = require("../models/Message");

// Map: userId -> Set of socket IDs
const onlineUsers = new Map();
// Map: socketId -> userId
const socketUserMap = new Map();

const registerChatSocket = (io) => {
  // Attach onlineUsers to io instance so controllers can access it
  io.onlineUsers = onlineUsers;

  io.on("connection", (socket) => {
    // 1. User Setup & Authentication on Socket Connect
    socket.on("setup", async (userData) => {
      if (!userData || (!userData._id && !userData.id)) return;
      const userId = (userData._id || userData.id).toString();

      socketUserMap.set(socket.id, userId);

      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
      }
      onlineUsers.get(userId).add(socket.id);

      // Join a private room for this user to receive direct notifications
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
    });

    // 2. Request current online users list
    socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers:list", Array.from(onlineUsers.keys()));
    });

    // 3. Conversation Rooms
    socket.on("joinConversation", (conversationId) => {
      if (!conversationId) return;
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("leaveConversation", (conversationId) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
    });

    // 4. Typing Indicators
    socket.on("typing:start", ({ conversationId, user }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("typing:started", {
        conversationId,
        user,
      });
    });

    socket.on("typing:stop", ({ conversationId, userId }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("typing:stopped", {
        conversationId,
        userId,
      });
    });

    // 5. Read Receipts
    socket.on("markAsRead", async ({ conversationId, userId }) => {
      if (!conversationId || !userId) return;

      try {
        await Message.updateMany(
          {
            conversation: conversationId,
            readBy: { $ne: userId },
          },
          {
            $addToSet: {
              readBy: userId,
              deliveredTo: userId,
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

    // 6. WebRTC Video & Audio Calling (WhatsApp-style)
    socket.on("call:initiate", ({ recipientId, conversationId, isVideo, caller, isGroup }) => {
      const senderId = socketUserMap.get(socket.id) || (caller?._id || caller?.id);
      if (!senderId) return;

      const payload = {
        caller,
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

    socket.on("call:accept", ({ callerId, recipient, conversationId, isVideo }) => {
      if (!callerId) return;
      io.to(`user:${callerId}`).emit("call:accepted", {
        recipient,
        conversationId,
        isVideo: !!isVideo,
      });
    });

    socket.on("call:signal", ({ targetUserId, signal, type }) => {
      if (!targetUserId) return;
      const senderId = socketUserMap.get(socket.id);
      io.to(`user:${targetUserId}`).emit("call:signal", {
        senderId,
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
      const senderId = socketUserMap.get(socket.id);
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit("call:ended", { fromUserId: senderId });
      }
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit("call:ended", { fromUserId: senderId });
      }
    });

    socket.on("call:toggle-media", ({ targetUserId, isMuted, isVideoOff }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit("call:media-toggled", {
        isMuted,
        isVideoOff,
      });
    });

    // 7. Handle Disconnect

    socket.on("disconnect", async () => {
      const userId = socketUserMap.get(socket.id);
      socketUserMap.delete(socket.id);

      if (userId && onlineUsers.has(userId)) {
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
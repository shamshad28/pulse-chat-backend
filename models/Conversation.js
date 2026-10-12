const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
      default: "direct",
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    avatar: {
      type: String,
      default: "",
    },

    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes for concurrent user lookups
conversationSchema.index({ members: 1, updatedAt: -1 });
conversationSchema.index({ type: 1, members: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
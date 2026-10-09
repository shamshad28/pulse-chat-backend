const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    content: {
      type: String,
      trim: true,
      default: "",
    },

    type: {
      type: String,
      enum: ["text", "image", "video", "document", "audio"],
      default: "text",
    },

    attachments: [
      {
        url: {
          type: String,
        },

        publicId: {
          type: String,
        },

        fileName: {
          type: String,
        },

        mimeType: {
          type: String,
        },

        size: {
          type: Number,
        },
      },
    ],

    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },

        emoji: {
          type: String,
        },
      },
    ],

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ content: "text" });

module.exports = mongoose.model("Message", messageSchema);
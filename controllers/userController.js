const mongoose = require("mongoose");
const User = require("../models/User");

// Helper to escape RegExp special characters to prevent ReDoS
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Helper to validate safe avatar URLs
const isSafeAvatarUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("/uploads/")) return true;
  if (trimmed.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

// Search users by name or username (excl. email to prevent PII harvesting)
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const rawQuery = typeof q === "string" ? q.trim() : "";

    if (!rawQuery) {
      return res.status(200).json({
        success: true,
        users: [],
      });
    }

    // Limit search term length to prevent ReDoS
    const sanitizedQuery = escapeRegExp(rawQuery.slice(0, 40));

    const filter = {
      _id: { $ne: req.user._id },
      $or: [
        { name: { $regex: sanitizedQuery, $options: "i" } },
        { username: { $regex: sanitizedQuery, $options: "i" } },
      ],
    };

    // Note: 'email' is deliberately excluded to protect private user data
    const users = await User.find(filter)
      .select("name username avatar status lastSeen")
      .limit(20)
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Search users error:", error);
    res.status(500).json({
      success: false,
      message: "Server error searching users",
    });
  }
};

// Get contacts (email is excluded to protect private user data)
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select("name username avatar status lastSeen")
      .limit(50)
      .sort({ status: -1, updatedAt: -1 });

    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching users",
    });
  }
};

// Get current logged-in user profile (includes private data like email)
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name username email avatar status lastSeen createdAt"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("GetMe error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching profile",
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const updateData = {};

    if (typeof name === "string") {
      const trimmedName = name.trim();
      if (trimmedName.length < 2 || trimmedName.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 50 characters",
        });
      }
      updateData.name = trimmedName;
    }

    if (typeof avatar === "string") {
      const trimmedAvatar = avatar.trim();
      if (trimmedAvatar && !isSafeAvatarUrl(trimmedAvatar)) {
        return res.status(400).json({
          success: false,
          message: "Avatar must be a valid HTTP/HTTPS URL, uploaded file, or image data URL",
        });
      }
      if (trimmedAvatar.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Avatar URL is too long",
        });
      }
      updateData.avatar = trimmedAvatar;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("name username email avatar status lastSeen");

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating profile",
    });
  }
};

// Get user by id (authorization: email only returned if self)
const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const isSelf = req.user._id.toString() === userId.toString();

    // Select email only if the user is fetching their own profile
    const selectFields = isSelf
      ? "name username email avatar status lastSeen"
      : "name username avatar status lastSeen";

    const user = await User.findById(userId).select(selectFields);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching user",
    });
  }
};

module.exports = {
  searchUsers,
  getUsers,
  getMe,
  updateProfile,
  getUserById,
};

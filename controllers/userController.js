const User = require("../models/User");

// Search users by name, username, or email
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const queryStr = typeof q === "string" ? q.trim() : "";

    const filter = {
      _id: { $ne: req.user._id },
    };

    if (queryStr) {
      filter.$or = [
        { name: { $regex: queryStr, $options: "i" } },
        { username: { $regex: queryStr, $options: "i" } },
        { email: { $regex: queryStr, $options: "i" } },
      ];
    }

    const users = await User.find(filter)
      .select("name username email avatar status lastSeen")
      .limit(30)
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

// Get all users (contacts)
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select("name username email avatar status lastSeen")
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

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const updateData = {};

    if (typeof name === "string" && name.trim()) {
      updateData.name = name.trim();
    }
    if (typeof avatar === "string") {
      updateData.avatar = avatar.trim();
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

// Get user by id
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "name username email avatar status lastSeen"
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
  updateProfile,
  getUserById,
};

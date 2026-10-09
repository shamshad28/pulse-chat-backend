const express = require("express");
const multer = require("multer");
const protect = require("../middleware/authMiddleware");
const { uploadFile } = require("../services/uploadService");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

router.post(
  "/",
  protect,
  upload.array("files", 10),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        });
      }

      const uploadPromises = req.files.map((file) => uploadFile(file, req));
      const uploadedAttachments = await Promise.all(uploadPromises);

      res.status(200).json({
        success: true,
        attachments: uploadedAttachments,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: "Server error uploading file: " + error.message,
      });
    }
  }
);

module.exports = router;

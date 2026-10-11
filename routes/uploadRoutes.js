const express = require("express");
const protect = require("../middleware/authMiddleware");
const { upload } = require("../middleware/uploadMiddleware");
const { uploadLimiter } = require("../middleware/securityMiddleware");
const { uploadFile } = require("../services/uploadService");

const router = express.Router();

router.post(
  "/",
  protect,
  uploadLimiter,
  (req, res, next) => {
    upload.array("files", 5)(req, res, (err) => {
      if (err) {
        console.warn("Upload validation error:", err.message);
        return res.status(400).json({
          success: false,
          message: err.message || "File upload validation error",
        });
      }
      next();
    });
  },
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

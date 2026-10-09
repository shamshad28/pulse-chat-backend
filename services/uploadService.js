const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;

const isCloudinaryConfigured = () => {
  return (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const getFileType = (mimeType) => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
};

const uploadFile = async (file, req) => {
  const fileType = getFileType(file.mimetype);

  if (isCloudinaryConfigured()) {
    try {
      const resourceType = fileType === "image" ? "image" : fileType === "video" ? "video" : "raw";
      
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: resourceType,
            folder: "chat_media",
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });

      return {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        type: fileType,
      };
    } catch (err) {
      console.warn("Cloudinary upload failed, falling back to local storage:", err.message);
    }
  }

  // Local storage fallback
  const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname.replace(/\s+/g, "_")}`;
  const filePath = path.join(uploadsDir, uniqueName);
  fs.writeFileSync(filePath, file.buffer);

  const protocol = req.protocol || "http";
  const host = req.get("host") || "localhost:5000";
  const fileUrl = `${protocol}://${host}/uploads/${uniqueName}`;

  return {
    url: fileUrl,
    publicId: uniqueName,
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    type: fileType,
  };
};

module.exports = {
  uploadFile,
  getFileType,
  uploadsDir,
};

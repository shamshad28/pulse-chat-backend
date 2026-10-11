const jwt = require("jsonwebtoken");

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: JWT_SECRET environment variable is missing in production!");
    }
    return "pulsechat_jwt_secret_key_2026_fallback";
  }
  return secret;
};

const generateToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
};

const verifyToken = (token) => {
  if (!token || typeof token !== "string") {
    throw new Error("Token missing or invalid");
  }
  return jwt.verify(token, getJwtSecret());
};

module.exports = {
  getJwtSecret,
  generateToken,
  verifyToken,
};

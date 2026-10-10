const jwt = require("jsonwebtoken");

const generateToken = (userId) => {
  const secret = process.env.JWT_SECRET || "pulsechat_jwt_secret_key_2026_fallback";
  if (!process.env.JWT_SECRET) {
    console.warn("⚠️ WARNING: JWT_SECRET is not set in environment variables. Using fallback secret.");
  }

  return jwt.sign(
    {
      userId,
    },
    secret,
    {
      expiresIn: "7d",
    }
  );
};

module.exports = generateToken;
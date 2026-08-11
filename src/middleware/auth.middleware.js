import crypto from "crypto";
import jwt from "jsonwebtoken";

const getAccessSecret = () => (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "").trim();

const timingSafeEqual = (provided, expected) => {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const extractAccessToken = (req) => {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.split(" ")[1];
  if (req.cookies?.authToken) return req.cookies.authToken;
  return null;
};

export const authenticate = (req, res, next) => {
  const accessToken = extractAccessToken(req);

  if (!accessToken) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(accessToken, getAccessSecret());
    const userId = decoded.id || decoded.userId || decoded._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }
    req.user = { id: userId, role: decoded.role || "user" };
    req.userId = userId;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const verifyInternalToken = (req, res, next) => {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    return res.status(503).json({ success: false, message: "Internal API not configured" });
  }
  const provided = req.headers["x-internal-token"];
  if (!timingSafeEqual(provided, expected)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
};

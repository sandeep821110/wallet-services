import jwt from "jsonwebtoken";

const getAccessSecret = () => (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "").trim();

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

import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please log in first." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ code: "SESSION_INVALID", message: "Account no longer exists." });

    req.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, preferredLanguage: user.preferredLanguage };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
      return res.status(401).json({ code: "SESSION_INVALID", message: "Your session is invalid or expired. Please log in again." });
    }
    return next(error);
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to access this resource." });
    }
    next();
  };
}

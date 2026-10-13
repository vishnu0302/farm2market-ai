import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();
const allowedRoles = ["farmer", "trader", "warehouse", "transporter"];
const allowedLanguages = ["en", "te", "hi", "ta"];

function createToken(user) {
  return jwt.sign({ userId: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    preferredLanguage: user.preferredLanguage || "en"
  };
}

router.post("/signup", async (req, res, next) => {
  try {
    const { name, email, password, role, preferredLanguage = "en" } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Name, email, password and role are required." });
    }
    if (String(name).trim().length < 2 || String(name).trim().length > 80) {
      return res.status(400).json({ message: "Name must be between 2 and 80 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Choose a valid account role." });
    }
    if (!allowedLanguages.includes(preferredLanguage)) {
      return res.status(400).json({ message: "Choose a supported language." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ code: "DUPLICATE_ACCOUNT", message: "An account with this email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      role,
      preferredLanguage
    });

    return res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ code: "DUPLICATE_ACCOUNT", message: "An account with this email already exists." });
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password || !role) {
      return res.status(400).json({ message: "Email, password and role are required." });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Choose a valid account role." });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select("+passwordHash");
    if (!user || user.role !== role || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email, password or selected account type." });
    }

    return res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get("/me", protect, async (req, res) => {
  res.json({ user: req.user });
});

export default router;

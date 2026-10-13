import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      required: true,
      enum: ["farmer", "trader", "warehouse", "transporter"]
    },
    preferredLanguage: { type: String, enum: ["en", "te", "hi", "ta"], default: "en" }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

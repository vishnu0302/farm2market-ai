import mongoose from "mongoose";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI. Copy backend/.env.example to backend/.env and configure it.");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET must be set to a random string of at least 32 characters.");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Atlas connected");
    app.listen(PORT, () => console.log(`Farm2Market API running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not connect to MongoDB. Check your Atlas URI, database user/password, and Network Access IP allowlist.");
    console.error(error.message);
    process.exit(1);
  }
}

start();

import mongoose from "mongoose";

const riskAlertAcknowledgmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  alertKey: { type: String, required: true, minlength: 64, maxlength: 64 },
  acknowledgedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

riskAlertAcknowledgmentSchema.index({ user: 1, alertKey: 1 }, { unique: true });

export default mongoose.model("RiskAlertAcknowledgment", riskAlertAcknowledgmentSchema);

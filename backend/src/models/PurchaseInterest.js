import mongoose from "mongoose";

const purchaseInterestSchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  batchId: { type: String, required: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  trader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" }
}, { timestamps: true });

purchaseInterestSchema.index({ batch: 1, trader: 1 }, { unique: true });

export default mongoose.model("PurchaseInterest", purchaseInterestSchema);

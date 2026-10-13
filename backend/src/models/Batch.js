import mongoose from "mongoose";

const batchSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true, index: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  farmerName: { type: String, required: true },
  cropName: { type: String, required: true, trim: true, maxlength: 60 },
  variety: { type: String, trim: true, maxlength: 80 },
  quantityKg: { type: Number, required: true, min: 0.01 },
  harvestDate: { type: Date, required: true },
  farmLocation: { type: String, required: true, trim: true, maxlength: 120 },
  marketName: { type: String, required: true },
  estimatedPricePerKg: { type: Number, required: true, min: 0 },
  marketState: { type: String, trim: true, maxlength: 80 },
  marketDistrict: { type: String, trim: true, maxlength: 80 },
  marketVariety: { type: String, trim: true, maxlength: 80 },
  marketReportedDate: { type: Date },
  marketRetrievedAt: { type: Date },
  marketPriceMinPerQuintal: { type: Number, min: 0 },
  marketPriceMaxPerQuintal: { type: Number, min: 0 },
  marketModalPricePerQuintal: { type: Number, min: 0 },
  marketPriceUnit: { type: String, enum: ["INR_PER_QUINTAL"], default: undefined },
  estimatedGross: { type: Number, required: true, min: 0 },
  transportCost: { type: Number, required: true, min: 0 },
  handlingCost: { type: Number, required: true, min: 0 },
  otherCosts: { type: Number, min: 0, default: 0 },
  marketDistanceKm: { type: Number, min: 0, default: null },
  estimatedNet: { type: Number, required: true },
  estimateSource: { type: String, default: "DEMO_ESTIMATE" },
  isPublished: { type: Boolean, default: false, index: true },
  warehouseStorageAuthorized: { type: Boolean, default: false },
  warehouseStoredQuantityKg: { type: Number, min: 0, default: 0, select: false },
  status: { type: String, enum: ["Draft", "Available", "Buyer interested", "Sold"], default: "Draft" },
  statusUpdatedAt: { type: Date }
}, { timestamps: true });

export default mongoose.model("Batch", batchSchema);

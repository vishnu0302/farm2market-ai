import mongoose from "mongoose";

export const DELIVERY_SHARE_STATUSES = ["Requested", "Accepted", "Rejected", "Delivered", "Cancelled"];

const deliveryShareSchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  batchId: { type: String, required: true, index: true },
  transporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  cropName: { type: String, required: true },
  pickupLocation: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  destination: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  quantityKg: { type: Number, required: true, min: 0.01 },
  estimatedTransportCost: { type: Number, required: true, min: 0 },
  dispatchDate: { type: Date, required: true },
  expectedDeliveryDate: { type: Date, required: true },
  status: { type: String, enum: DELIVERY_SHARE_STATUSES, required: true, default: "Requested" },
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: "Delivery", default: null }
}, { timestamps: true });

deliveryShareSchema.index({ batch: 1, transporter: 1, requester: 1 }, { unique: true });

export default mongoose.model("DeliveryShare", deliveryShareSchema);

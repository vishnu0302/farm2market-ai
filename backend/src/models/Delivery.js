import mongoose from "mongoose";

export const DELIVERY_STATUSES = ["Requested", "Accepted", "In Transit", "Delivered", "Cancelled"];

const deliverySchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  batchId: { type: String, required: true, index: true },
  transporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  sourceShare: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryShare", unique: true, sparse: true },
  cropName: { type: String, required: true },
  pickupLocation: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  destination: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  quantityKg: { type: Number, required: true, min: 0.01 },
  estimatedTransportCost: { type: Number, required: true, min: 0 },
  dispatchDate: { type: Date, required: true },
  expectedDeliveryDate: { type: Date, required: true },
  status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "Requested" },
  statusUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Delivery", deliverySchema);

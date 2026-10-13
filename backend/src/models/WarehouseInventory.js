import mongoose from "mongoose";

export const STORAGE_TYPES = ["Ambient", "Cold", "Dry", "Refrigerated"];
export const STORAGE_STATUSES = ["Stored", "Quality Check", "Spoiled", "Partially Dispatched", "Dispatched"];

const warehouseInventorySchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "StorageFacility", required: true, index: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  batchId: { type: String, required: true, index: true },
  cropName: { type: String, required: true },
  receivedQuantityKg: { type: Number, required: true, min: 0.01 },
  storedQuantityKg: { type: Number, required: true, min: 0 },
  dispatchedQuantityKg: { type: Number, required: true, min: 0, default: 0 },
  storageType: { type: String, required: true, enum: STORAGE_TYPES },
  storageDate: { type: Date, required: true },
  status: { type: String, required: true, enum: STORAGE_STATUSES, default: "Stored" },
  lastDispatchedAt: { type: Date, default: null }
}, { timestamps: true });

warehouseInventorySchema.index({ facility: 1, batch: 1 }, { unique: true });

export default mongoose.model("WarehouseInventory", warehouseInventorySchema);

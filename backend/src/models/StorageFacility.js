import mongoose from "mongoose";

const storageFacilitySchema = new mongoose.Schema({
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  location: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  capacityKg: { type: Number, required: true, min: 1 },
  usedCapacityKg: { type: Number, min: 0, default: 0 },
  supportedCropTypes: {
    type: [{ type: String, trim: true, lowercase: true, minlength: 2, maxlength: 60 }],
    required: true,
    validate: {
      validator: crops => Array.isArray(crops) && crops.length > 0 && new Set(crops).size === crops.length,
      message: "Add at least one unique supported crop type."
    }
  }
}, { timestamps: true });

export default mongoose.model("StorageFacility", storageFacilitySchema);

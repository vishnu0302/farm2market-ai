import { Router } from "express";
import mongoose from "mongoose";
import Batch from "../models/Batch.js";
import StorageFacility from "../models/StorageFacility.js";
import WarehouseInventory, { STORAGE_TYPES, STORAGE_STATUSES } from "../models/WarehouseInventory.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { isValidBatchId } from "../utils/batchId.js";

const router = Router();

router.use(protect, allowRoles("warehouse"));

function validObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function validAmount(value, maximum) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= maximum ? amount : null;
}

function parseStorageDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function safeFacility(facility) {
  return {
    id: facility._id.toString(),
    name: facility.name,
    location: facility.location,
    capacityKg: facility.capacityKg,
    usedCapacityKg: facility.usedCapacityKg,
    availableCapacityKg: Math.max(0, facility.capacityKg - facility.usedCapacityKg),
    supportedCropTypes: facility.supportedCropTypes
  };
}

function safeInventory(inventory) {
  return {
    id: inventory._id.toString(),
    batchId: inventory.batchId,
    cropName: inventory.cropName,
    receivedQuantityKg: inventory.receivedQuantityKg,
    storedQuantityKg: inventory.storedQuantityKg,
    dispatchedQuantityKg: inventory.dispatchedQuantityKg,
    storageType: inventory.storageType,
    storageDate: inventory.storageDate,
    status: inventory.status,
    lastDispatchedAt: inventory.lastDispatchedAt
  };
}

router.get("/facilities", async (req, res, next) => {
  try {
    const facilities = await StorageFacility.find({ warehouse: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ facilities: facilities.map(safeFacility) });
  } catch (error) { next(error); }
});

router.post("/facilities", async (req, res, next) => {
  try {
    const { name, location, capacityKg, supportedCropTypes } = req.body || {};
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedLocation = typeof location === "string" ? location.trim() : "";
    const capacity = Number(capacityKg);

    if (normalizedName.length < 2 || normalizedName.length > 100) {
      return res.status(400).json({ message: "Facility name must be between 2 and 100 characters." });
    }
    if (normalizedLocation.length < 2 || normalizedLocation.length > 120) {
      return res.status(400).json({ message: "Enter a village or location between 2 and 120 characters." });
    }
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 1000000000) {
      return res.status(400).json({ message: "Capacity must be a positive number no greater than 1,000,000,000 kg." });
    }
    if (!Array.isArray(supportedCropTypes) || supportedCropTypes.length === 0 || supportedCropTypes.length > 50) {
      return res.status(400).json({ message: "Choose at least one supported crop type." });
    }
    const crops = supportedCropTypes.map(crop => typeof crop === "string" ? crop.trim().toLowerCase() : "");
    if (crops.some(crop => crop.length < 2 || crop.length > 60) || new Set(crops).size !== crops.length) {
      return res.status(400).json({ message: "Crop types must be unique names between 2 and 60 characters." });
    }

    const facility = await StorageFacility.create({
      warehouse: req.user.id,
      name: normalizedName,
      location: normalizedLocation,
      capacityKg: capacity,
      supportedCropTypes: crops
    });
    res.status(201).json({ facility: safeFacility(facility), noticeCode: "FACILITY_REGISTERED", message: "Storage facility registered." });
  } catch (error) { next(error); }
});

router.get("/facilities/:facilityId/inventory", async (req, res, next) => {
  const { facilityId } = req.params;
  if (!validObjectId(facilityId)) return res.status(400).json({ message: "Enter a valid facility ID." });

  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 80) : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const crop = typeof req.query.crop === "string" ? req.query.crop.trim().toLowerCase() : "";
  if (status && !STORAGE_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Choose a valid inventory status filter." });
  }

  try {
    const facility = await StorageFacility.findOne({ _id: facilityId, warehouse: req.user.id }).lean();
    if (!facility) return res.status(404).json({ message: "Storage facility not found." });

    const filter = { facility: facility._id, warehouse: req.user.id };
    if (status) filter.status = status;
    if (crop) filter.cropName = crop;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { batchId: { $regex: escaped, $options: "i" } },
        { cropName: { $regex: escaped, $options: "i" } }
      ];
    }
    const inventory = await WarehouseInventory.find(filter).sort({ storageDate: 1, createdAt: 1 }).lean();
    const oldestStored = await WarehouseInventory.find({
      facility: facility._id,
      warehouse: req.user.id,
      storedQuantityKg: { $gt: 0 }
    }).sort({ storageDate: 1, createdAt: 1 }).limit(5).lean();

    res.json({
      facility: safeFacility(facility),
      inventory: inventory.map(safeInventory),
      oldestStored: oldestStored.map(safeInventory)
    });
  } catch (error) { next(error); }
});

router.post("/facilities/:facilityId/inventory", async (req, res, next) => {
  const { facilityId } = req.params;
  const { batchId, quantityKg, storageType, storageDate } = req.body || {};
  if (!validObjectId(facilityId)) return res.status(400).json({ message: "Enter a valid facility ID." });
  if (typeof batchId !== "string" || !isValidBatchId(batchId)) {
    return res.status(400).json({ message: "Enter a valid existing batch ID." });
  }
  const quantity = validAmount(quantityKg, 100000000);
  if (quantity === null) return res.status(400).json({ message: "Stored quantity must be greater than zero and no more than 100,000,000 kg." });
  if (!STORAGE_TYPES.includes(storageType)) return res.status(400).json({ message: "Choose a supported storage type." });
  const storedAt = parseStorageDate(storageDate);
  const today = new Date().toISOString().slice(0, 10);
  if (!storedAt || storageDate > today) {
    return res.status(400).json({ message: "Enter a valid storage date that is not in the future." });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let createdInventory;
    await session.withTransaction(async () => {
      const batch = await Batch.findOne({
        batchId,
        isPublished: true,
        warehouseStorageAuthorized: true,
        status: { $in: ["Available", "Buyer interested", "Sold"] }
      }).session(session);
      if (!batch) {
        const error = new Error("Published, farmer-authorized batch not found or not eligible for storage.");
        error.status = 404;
        throw error;
      }
      if (quantity > batch.quantityKg) {
        const error = new Error("Stored quantity cannot exceed the registered batch quantity.");
        error.status = 400;
        throw error;
      }

      const facility = await StorageFacility.findOne({
        _id: facilityId,
        warehouse: req.user.id,
        supportedCropTypes: batch.cropName.trim().toLowerCase()
      }).session(session);
      if (!facility) {
        const ownedFacility = await StorageFacility.findOne({ _id: facilityId, warehouse: req.user.id }).session(session);
        const error = new Error(ownedFacility ? "This facility does not support the batch crop type." : "Storage facility not found.");
        error.status = ownedFacility ? 400 : 404;
        throw error;
      }

      const capacityReservation = await StorageFacility.updateOne({
        _id: facility._id,
        warehouse: req.user.id,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ["$usedCapacityKg", 0] }, quantity] },
            "$capacityKg"
          ]
        }
      }, { $inc: { usedCapacityKg: quantity } }, { session });
      if (capacityReservation.modifiedCount !== 1) {
        const error = new Error("This facility does not have enough available capacity.");
        error.status = 409;
        throw error;
      }

      const batchReservation = await Batch.updateOne({
        _id: batch._id,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ["$warehouseStoredQuantityKg", 0] }, quantity] },
            "$quantityKg"
          ]
        }
      }, { $inc: { warehouseStoredQuantityKg: quantity } }, { session });
      if (batchReservation.modifiedCount !== 1) {
        const error = new Error("The remaining quantity for this batch is insufficient.");
        error.status = 409;
        throw error;
      }

      [createdInventory] = await WarehouseInventory.create([{
        facility: facility._id,
        warehouse: req.user.id,
        batch: batch._id,
        batchId: batch.batchId,
        cropName: batch.cropName,
        receivedQuantityKg: quantity,
        storedQuantityKg: quantity,
        storageType,
        storageDate: storedAt,
        status: "Stored"
      }], { session });
    });

    res.status(201).json({ inventory: safeInventory(createdInventory), noticeCode: "INVENTORY_RECEIVED", message: "Incoming batch recorded in warehouse inventory." });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "This batch is already recorded at this facility." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.patch("/facilities/:facilityId/inventory/:inventoryId/status", async (req, res, next) => {
  const { facilityId, inventoryId } = req.params;
  const { status } = req.body || {};
  if (!validObjectId(facilityId) || !validObjectId(inventoryId)) {
    return res.status(400).json({ message: "Enter valid facility and inventory IDs." });
  }
  if (!STORAGE_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Choose a valid storage status." });
  }

  try {
    const inventory = await WarehouseInventory.findOne({
      _id: inventoryId,
      facility: facilityId,
      warehouse: req.user.id
    });
    if (!inventory) return res.status(404).json({ message: "Inventory record not found." });
    const transitions = {
      Stored: ["Quality Check", "Spoiled"],
      "Quality Check": ["Stored", "Spoiled"],
      Spoiled: [],
      "Partially Dispatched": ["Stored", "Quality Check", "Spoiled"],
      Dispatched: []
    };
    if (!transitions[inventory.status].includes(status)) {
      return res.status(409).json({ message: `Cannot change status from ${inventory.status} to ${status}.` });
    }

    const updated = await WarehouseInventory.findOneAndUpdate({
      _id: inventory._id,
      facility: facilityId,
      warehouse: req.user.id,
      status: inventory.status
    }, { $set: { status } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: "Inventory status changed. Refresh and try again." });
    res.json({ inventory: safeInventory(updated), noticeCode: "INVENTORY_STATUS_UPDATED", message: "Storage status updated." });
  } catch (error) { next(error); }
});

router.post("/facilities/:facilityId/inventory/:inventoryId/outgoing", async (req, res, next) => {
  const { facilityId, inventoryId } = req.params;
  const quantity = validAmount(req.body?.quantityKg, 100000000);
  if (!validObjectId(facilityId) || !validObjectId(inventoryId)) {
    return res.status(400).json({ message: "Enter valid facility and inventory IDs." });
  }
  if (quantity === null) return res.status(400).json({ message: "Outgoing quantity must be greater than zero and no more than 100,000,000 kg." });

  let session;
  try {
    session = await mongoose.startSession();
    let updatedInventory;
    await session.withTransaction(async () => {
      const inventory = await WarehouseInventory.findOne({
        _id: inventoryId,
        facility: facilityId,
        warehouse: req.user.id
      }).session(session);
      if (!inventory) {
        const error = new Error("Inventory record not found.");
        error.status = 404;
        throw error;
      }
      if (quantity > inventory.storedQuantityKg || inventory.storedQuantityKg <= 0) {
        const error = new Error("Outgoing quantity exceeds the quantity currently in storage.");
        error.status = 400;
        throw error;
      }
      if (inventory.status === "Dispatched") {
        const error = new Error("This batch has already been fully dispatched.");
        error.status = 409;
        throw error;
      }
      if (inventory.status === "Spoiled") {
        const error = new Error("Spoiled inventory cannot be recorded as outgoing for delivery.");
        error.status = 409;
        throw error;
      }

      const remaining = Math.round((inventory.storedQuantityKg - quantity) * 100) / 100;
      inventory.storedQuantityKg = remaining;
      inventory.dispatchedQuantityKg = Math.round((inventory.dispatchedQuantityKg + quantity) * 100) / 100;
      inventory.status = remaining === 0 ? "Dispatched" : "Partially Dispatched";
      inventory.lastDispatchedAt = new Date();
      await inventory.save({ session });

      const facilityReservation = await StorageFacility.updateOne({
        _id: facilityId,
        warehouse: req.user.id,
        usedCapacityKg: { $gte: quantity }
      }, { $inc: { usedCapacityKg: -quantity } }, { session });
      if (facilityReservation.modifiedCount !== 1) {
        throw new Error("Warehouse capacity counter is inconsistent; no dispatch was recorded.");
      }
      const batchReservation = await Batch.updateOne({
        _id: inventory.batch,
        warehouseStoredQuantityKg: { $gte: quantity }
      }, { $inc: { warehouseStoredQuantityKg: -quantity } }, { session });
      if (batchReservation.modifiedCount !== 1) {
        throw new Error("Batch storage counter is inconsistent; no dispatch was recorded.");
      }
      updatedInventory = inventory;
    });

    res.json({ inventory: safeInventory(updatedInventory), noticeCode: "OUTGOING_RECORDED", message: "Outgoing batch quantity recorded." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

export default router;

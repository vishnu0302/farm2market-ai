import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Batch from "../models/Batch.js";
import WarehouseInventory from "../models/WarehouseInventory.js";
import Delivery from "../models/Delivery.js";
import PurchaseInterest from "../models/PurchaseInterest.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { buildPublicTraceability, isValidPublicTraceabilityId } from "../services/traceabilityService.js";
import { calculateMarketReturn, MarketCalculationError } from "../services/marketComparisonService.js";
import { assessBatchSpoilageRisk } from "../services/spoilageRiskService.js";
import { fetchMandiPrices, MandiPriceError } from "../services/mandiPriceService.js";
import { isValidBatchId } from "../utils/batchId.js";

const router = Router();

router.get("/public/:batchId", async (req, res, next) => {
  const { batchId: traceabilityId } = req.params;
  if (!isValidPublicTraceabilityId(traceabilityId)) {
    return res.status(400).json({ message: "Enter a valid public traceability ID." });
  }

  try {
    const batch = await Batch.findOne({ batchId: traceabilityId })
      .select("batchId cropName variety marketVariety quantityKg harvestDate farmLocation status statusUpdatedAt createdAt")
      .lean();
    if (!batch) return res.status(404).json({ message: "No batch was found for this traceability ID." });

    const [inventory, deliveries, purchaseInterests] = await Promise.all([
      WarehouseInventory.find({ batch: batch._id }).select("storageType storageDate status storedQuantityKg lastDispatchedAt createdAt updatedAt -_id").lean(),
      Delivery.find({ batch: batch._id }).select("status destination quantityKg expectedDeliveryDate statusUpdatedAt updatedAt -_id").lean(),
      PurchaseInterest.find({ batch: batch._id }).select("status createdAt updatedAt -_id").lean()
    ]);
    const assessedAt = new Date();
    const riskAssessment = assessBatchSpoilageRisk({
      harvestDate: batch.harvestDate,
      inventoryRecords: inventory,
      deliveries,
      storageContextAvailable: true,
      now: assessedAt
    });
    return res.json({
      batch: buildPublicTraceability(batch, inventory, deliveries, {
        purchaseInterests,
        riskAssessment,
        assessedAt
      }),
      informationNotice: "These are recorded platform entries supplied by participating accounts, not independent verification."
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/marketplace", protect, allowRoles("trader"), async (req, res, next) => {
  try {
    const batches = await Batch.find({
      isPublished: true,
      status: { $in: ["Available", "Buyer interested"] },
      farmer: { $ne: req.user.id }
    })
      .select("-_id batchId cropName quantityKg harvestDate status estimateSource")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ batches });
  } catch (error) { next(error); }
});

router.get("/", protect, allowRoles("farmer"), async (req, res, next) => {
  try {
    const batches = await Batch.find({ farmer: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ batches });
  } catch (error) { next(error); }
});

router.patch("/:batchId/publish", protect, allowRoles("farmer"), async (req, res, next) => {
  const { batchId } = req.params;
  if (!isValidBatchId(batchId)) {
    return res.status(400).json({ message: "Enter a valid batch ID." });
  }

  try {
    const batch = await Batch.findOneAndUpdate(
      {
        batchId,
        farmer: req.user.id,
        isPublished: { $ne: true },
        status: { $in: ["Draft", "Available"] }
      },
      { $set: { isPublished: true, status: "Available", statusUpdatedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (batch) {
      return res.json({ batch, noticeCode: "BATCH_PUBLISHED", message: "Batch published and available to traders." });
    }

    const ownedBatch = await Batch.findOne({ batchId, farmer: req.user.id }).select("isPublished status");
    if (!ownedBatch) return res.status(404).json({ message: "Batch not found." });
    if (ownedBatch.isPublished) return res.status(409).json({ message: "This batch is already published." });
    if (!["Draft", "Available"].includes(ownedBatch.status)) {
      return res.status(409).json({ message: "Only draft or available batches can be published." });
    }
    return res.status(409).json({ message: "Batch publication state changed. Refresh and try again." });
  } catch (error) { next(error); }
});

router.patch("/:batchId/warehouse-authorization", protect, allowRoles("farmer"), async (req, res, next) => {
  const { batchId } = req.params;
  const { authorized } = req.body || {};
  if (!isValidBatchId(batchId)) return res.status(400).json({ message: "Enter a valid batch ID." });
  if (typeof authorized !== "boolean") {
    return res.status(400).json({ message: "Warehouse authorization must be true or false." });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let updatedBatch;
    await session.withTransaction(async () => {
      const batch = await Batch.findOne({ batchId, farmer: req.user.id }).session(session);
      if (!batch) {
        const error = new Error("Batch not found.");
        error.status = 404;
        throw error;
      }
      if (authorized && (!batch.isPublished || !["Available", "Buyer interested", "Sold"].includes(batch.status))) {
        const error = new Error("Only a published, storage-eligible batch can be authorized for warehouse intake.");
        error.status = 409;
        throw error;
      }
      if (!authorized && batch.warehouseStorageAuthorized) {
        const storedInventory = await WarehouseInventory.exists({
          batch: batch._id,
          storedQuantityKg: { $gt: 0 }
        }).session(session);
        if (storedInventory) {
          const error = new Error("Warehouse authorization cannot be revoked while any warehouse still holds this batch.");
          error.status = 409;
          throw error;
        }
      }
      batch.warehouseStorageAuthorized = authorized;
      await batch.save({ session });
      updatedBatch = batch;
    });
    res.json({
      batch: updatedBatch,
      noticeCode: authorized ? "WAREHOUSE_AUTHORIZED" : "WAREHOUSE_AUTHORIZATION_REVOKED",
      message: authorized
        ? "Warehouse storage authorized for this batch."
        : "Warehouse storage authorization revoked."
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.post("/", protect, allowRoles("farmer"), async (req, res, next) => {
  try {
    const { cropName, variety, quantityKg, harvestDate, farmLocation, mandiRecord, transportCost, handlingCost, otherCosts, marketDistanceKm } = req.body || {};
    const harvest = new Date(harvestDate);

    if (!cropName || String(cropName).trim().length < 2) return res.status(400).json({ message: "Enter a valid crop name." });
    if (!harvestDate || Number.isNaN(harvest.getTime())) return res.status(400).json({ message: "Choose a valid harvest date." });
    if (harvest > new Date(Date.now() + 86400000)) return res.status(400).json({ message: "Harvest date cannot be far in the future." });
    if (!farmLocation || String(farmLocation).trim().length < 2) return res.status(400).json({ message: "Enter your village or farm location." });
    if (variety !== undefined && variety !== null && String(variety).trim().length > 80) return res.status(400).json({ message: "Variety must be 80 characters or fewer." });

    const hasMarketRecord = mandiRecord && typeof mandiRecord === "object" && typeof mandiRecord.id === "string";
    let market = null;
    let calculation;
    if (hasMarketRecord) {
      const filters = {
        commodity: mandiRecord.commodity,
        state: mandiRecord.state,
        district: mandiRecord.district,
        market: mandiRecord.market,
        variety: mandiRecord.variety,
        reportDate: mandiRecord.reportDate
      };
      const currentPrices = await fetchMandiPrices(filters);
      market = currentPrices.records.find(record => record.id === mandiRecord.id);
      if (!market) return res.status(409).json({ code: "MARKET_RECORD_EXPIRED", message: "The selected mandi price is no longer in the latest available records. Search again." });
      if (!market.priceUnitVerified || !Number.isFinite(market.modalPricePerKg)) return res.status(503).json({ code: "MARKET_PRICE_UNIT_UNVERIFIED", message: "The official price unit has not been confirmed. Per-kg returns cannot be calculated yet." });
      if (String(cropName).trim().toLowerCase() !== market.commodity.toLowerCase()) return res.status(400).json({ message: "Selected mandi record does not match the chosen crop." });
      try {
        calculation = calculateMarketReturn({ quantityKg, pricePerKg: market.modalPricePerKg, transportCost, handlingCost, otherCosts });
      } catch (error) {
        if (error instanceof MarketCalculationError) return res.status(400).json({ message: error.message });
        throw error;
      }
    } else {
      const quantity = Number(quantityKg);
      if (!Number.isFinite(quantity) || quantity < 0.01 || quantity > 100000000) return res.status(400).json({ message: "Quantity (kg) must be between 0.01 and 100000000." });
      const costs = [transportCost, handlingCost, otherCosts].map(value => value === undefined || value === null || value === "" ? 0 : Number(value));
      if (costs.some(value => !Number.isFinite(value) || value < 0 || value > 1000000000)) return res.status(400).json({ message: "Costs must be non-negative numbers." });
      calculation = { quantityKg: quantity, pricePerKg: 0, estimatedGross: 0, transportCost: costs[0], handlingCost: costs[1], otherCosts: costs[2], estimatedNet: -(costs[0] + costs[1] + costs[2]) };
    }
    const distance = marketDistanceKm === undefined || marketDistanceKm === null || marketDistanceKm === ""
      ? null
      : (typeof marketDistanceKm === "number" || (typeof marketDistanceKm === "string" && marketDistanceKm.trim() !== "")
        ? Number(marketDistanceKm)
        : Number.NaN);
    if (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 10000000)) {
      return res.status(400).json({ message: "Market distance must be a non-negative number of kilometers." });
    }
    const batchId = `FM-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const batch = await Batch.create({
      batchId, farmer: req.user.id, farmerName: req.user.name,
      cropName: String(cropName).trim(), quantityKg: calculation.quantityKg, harvestDate: harvest,
      farmLocation: String(farmLocation).trim(), variety: variety ? String(variety).trim() : undefined, marketName: market?.market || "Not selected",
      estimatedPricePerKg: calculation.pricePerKg, estimatedGross: calculation.estimatedGross,
      marketState: market?.state,
      marketDistrict: market?.district,
      marketVariety: market?.variety,
      marketReportedDate: market ? new Date(`${market.reportDate}T00:00:00.000Z`) : undefined,
      marketRetrievedAt: market ? new Date(market.retrievedAt) : undefined,
      marketPriceMinPerQuintal: market?.minPricePerQuintal,
      marketPriceMaxPerQuintal: market?.maxPricePerQuintal,
      marketModalPricePerQuintal: market?.modalPricePerQuintal,
      marketPriceUnit: market?.sourceUnit === "INR_PER_QUINTAL" ? "INR_PER_QUINTAL" : undefined,
      transportCost: calculation.transportCost, handlingCost: calculation.handlingCost,
      otherCosts: calculation.otherCosts, marketDistanceKm: distance,
      estimatedNet: calculation.estimatedNet,
      estimateSource: market ? "AGMARKNET_REPORTED" : "PRICE_DATA_UNAVAILABLE", statusUpdatedAt: new Date()
    });
    res.status(201).json({ batch, estimateNotice: market ? "Reported AGMARKNET modal price used for an estimate; your eventual selling price may differ." : "Batch created without a market-price estimate because AGMARKNET price data is unavailable." });
  } catch (error) {
    if (error instanceof MandiPriceError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ code: "DUPLICATE_RECORD", message: "A batch with this ID already exists. Please try again." });
    }
    next(error);
  }
});

export default router;

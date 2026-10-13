import { Router } from "express";
import Batch from "../models/Batch.js";
import Delivery from "../models/Delivery.js";
import PurchaseInterest from "../models/PurchaseInterest.js";
import RiskAlertAcknowledgment from "../models/RiskAlertAcknowledgment.js";
import WarehouseInventory from "../models/WarehouseInventory.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { assessBatchSpoilageRisk, buildBatchRiskAlerts } from "../services/spoilageRiskService.js";

const router = Router();
const SUPPORTED_ROLES = ["farmer", "trader", "warehouse", "transporter"];
const alertRoles = [protect, allowRoles(...SUPPORTED_ROLES)];

async function getRelevantBatches(user) {
  if (user.role === "farmer") {
    return Batch.find({ farmer: user.id }).select("batchId cropName harvestDate").lean();
  }
  if (user.role === "trader") {
    const batchIds = await PurchaseInterest.distinct("batch", { trader: user.id, status: "Accepted" });
    return Batch.find({ _id: { $in: batchIds } }).select("batchId cropName harvestDate").lean();
  }
  if (user.role === "warehouse") {
    const batchIds = await WarehouseInventory.distinct("batch", { warehouse: user.id, storedQuantityKg: { $gt: 0 } });
    return Batch.find({ _id: { $in: batchIds } }).select("batchId cropName harvestDate").lean();
  }
  const batchIds = await Delivery.distinct("batch", { transporter: user.id });
  return Batch.find({ _id: { $in: batchIds } }).select("batchId cropName harvestDate").lean();
}

async function buildDashboard(user) {
  const batches = await getRelevantBatches(user);
  if (batches.length === 0) return { risks: [], alerts: [] };
  const batchIds = batches.map(batch => batch._id);
  const [inventory, deliveries] = await Promise.all([
    user.role === "warehouse"
      ? WarehouseInventory.find({
        batch: { $in: batchIds },
        warehouse: user.id,
        storedQuantityKg: { $gt: 0 },
        status: { $in: ["Stored", "Quality Check", "Partially Dispatched"] }
      }).select("batch batchId storedQuantityKg storageType storageDate status").lean()
      : Promise.resolve([]),
    user.role === "warehouse"
      ? Promise.resolve([])
      : Delivery.find({
        batch: { $in: batchIds },
        ...(user.role === "farmer" ? { requester: user.id } : {}),
        ...(user.role === "transporter" ? { transporter: user.id } : {}),
        ...(user.role === "trader" ? { requester: user.id } : {})
      }).select("batch batchId status expectedDeliveryDate statusUpdatedAt").lean()
  ]);

  const inventoryByBatch = new Map();
  for (const item of inventory) {
    const key = item.batch.toString();
    inventoryByBatch.set(key, [...(inventoryByBatch.get(key) || []), item]);
  }
  const deliveriesByBatch = new Map();
  for (const delivery of deliveries) {
    const key = delivery.batch.toString();
    deliveriesByBatch.set(key, [...(deliveriesByBatch.get(key) || []), delivery]);
  }

  const now = new Date();
  const assessments = batches.map(batch => {
    const inventoryRecords = inventoryByBatch.get(batch._id.toString()) || [];
    const relatedDeliveries = deliveriesByBatch.get(batch._id.toString()) || [];
    const assessment = assessBatchSpoilageRisk({
      harvestDate: batch.harvestDate,
      inventoryRecords,
      deliveries: relatedDeliveries,
      storageContextAvailable: user.role === "warehouse",
      now
    });
    return {
      batch,
      inventoryRecords,
      assessment,
      risk: {
        batchId: batch.batchId,
        cropName: batch.cropName,
        level: assessment.level,
        explanations: assessment.explanations
      },
      alerts: buildBatchRiskAlerts(batch, assessment, inventoryRecords, now)
    };
  });
  const alerts = assessments.flatMap(entry => entry.alerts)
    .sort((first, second) => {
      const severity = { High: 0, Medium: 1, Low: 2 };
      return severity[first.level] - severity[second.level] || first.batchId.localeCompare(second.batchId);
    });
  const acknowledgments = alerts.length
    ? await RiskAlertAcknowledgment.find({
      user: user.id,
      alertKey: { $in: alerts.map(alert => alert.key) }
    }).select("alertKey acknowledgedAt").lean()
    : [];
  const acknowledgedAtByKey = new Map(acknowledgments.map(item => [item.alertKey, item.acknowledgedAt]));

  return {
    risks: assessments.map(entry => entry.risk),
    alerts: alerts.map(alert => ({
      ...alert,
      acknowledgedAt: acknowledgedAtByKey.get(alert.key) || null
    }))
  };
}

router.get("/", ...alertRoles, async (req, res, next) => {
  try {
    res.json({ ...await buildDashboard(req.user), notice: "Rule-based estimate only; not a scientifically validated prediction." });
  } catch (error) { next(error); }
});

router.post("/:alertKey/acknowledge", ...alertRoles, async (req, res, next) => {
  const { alertKey } = req.params;
  if (!/^[a-f0-9]{64}$/.test(alertKey)) {
    return res.status(400).json({ message: "Enter a valid alert key." });
  }
  try {
    const dashboard = await buildDashboard(req.user);
    const alert = dashboard.alerts.find(item => item.key === alertKey);
    if (!alert) return res.status(404).json({ message: "Alert not found or its underlying conditions have changed." });

    const acknowledgment = await RiskAlertAcknowledgment.findOneAndUpdate(
      { user: req.user.id, alertKey },
      { $setOnInsert: { user: req.user.id, alertKey, acknowledgedAt: new Date() } },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({
      alert: { ...alert, acknowledgedAt: acknowledgment.acknowledgedAt },
      message: "Alert acknowledged."
    });
  } catch (error) {
    if (error.code === 11000) {
      try {
        const acknowledgment = await RiskAlertAcknowledgment.findOne({ user: req.user.id, alertKey }).lean();
        if (acknowledgment) return res.json({ message: "Alert acknowledged.", acknowledgedAt: acknowledgment.acknowledgedAt });
      } catch (readError) { return next(readError); }
    }
    next(error);
  }
});

export default router;

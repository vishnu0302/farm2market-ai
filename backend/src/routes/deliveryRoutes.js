import { Router } from "express";
import mongoose from "mongoose";
import Batch from "../models/Batch.js";
import Delivery, { DELIVERY_STATUSES } from "../models/Delivery.js";
import DeliveryShare from "../models/DeliveryShare.js";
import PurchaseInterest from "../models/PurchaseInterest.js";
import User from "../models/User.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { isValidBatchId } from "../utils/batchId.js";

const router = Router();
const DELIVERY_TRANSITIONS = {
  Requested: ["Accepted", "Cancelled"],
  Accepted: ["In Transit", "Cancelled"],
  "In Transit": ["Delivered", "Cancelled"],
  Delivered: [],
  Cancelled: []
};

router.use(protect);

function validObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function validQuantity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 100000000 ? quantity : null;
}

function validCost(value) {
  if (value === "" || value === null || value === undefined) return null;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 && cost <= 1000000000 ? cost : null;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function validatedRouteDetails(body) {
  const pickupLocation = typeof body.pickupLocation === "string" ? body.pickupLocation.trim() : "";
  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const quantityKg = validQuantity(body.quantityKg);
  const estimatedTransportCost = validCost(body.estimatedTransportCost);
  const dispatchDate = parseDate(body.dispatchDate);
  const expectedDeliveryDate = parseDate(body.expectedDeliveryDate);
  const today = new Date().toISOString().slice(0, 10);

  if (pickupLocation.length < 2 || pickupLocation.length > 160) {
    return { error: "Pickup location must be between 2 and 160 characters." };
  }
  if (destination.length < 2 || destination.length > 160) {
    return { error: "Destination must be between 2 and 160 characters." };
  }
  if (quantityKg === null) {
    return { error: "Delivery quantity must be greater than zero and no more than 100,000,000 kg." };
  }
  if (estimatedTransportCost === null) {
    return { error: "Estimated transport cost must be between 0 and 1,000,000,000." };
  }
  if (!dispatchDate || !expectedDeliveryDate || body.dispatchDate < today) {
    return { error: "Enter valid dispatch and expected delivery dates; dispatch cannot be in the past." };
  }
  if (expectedDeliveryDate < dispatchDate) {
    return { error: "Expected delivery date must be on or after the dispatch date." };
  }

  return { value: { pickupLocation, destination, quantityKg, estimatedTransportCost, dispatchDate, expectedDeliveryDate } };
}

function deliveryView(delivery) {
  const dispatchDate = new Date(delivery.dispatchDate);
  const expectedDeliveryDate = new Date(delivery.expectedDeliveryDate);
  const estimatedDurationDays = Math.round((expectedDeliveryDate - dispatchDate) / 86400000);
  return {
    id: delivery._id.toString(),
    batchId: delivery.batchId,
    cropName: delivery.cropName,
    pickupLocation: delivery.pickupLocation,
    destination: delivery.destination,
    quantityKg: delivery.quantityKg,
    estimatedTransportCost: delivery.estimatedTransportCost,
    dispatchDate: delivery.dispatchDate,
    expectedDeliveryDate: delivery.expectedDeliveryDate,
    estimatedDurationDays,
    status: delivery.status,
    statusUpdatedAt: delivery.statusUpdatedAt,
    createdAt: delivery.createdAt
  };
}

function shareView(share) {
  const estimatedDurationDays = Math.round((new Date(share.expectedDeliveryDate) - new Date(share.dispatchDate)) / 86400000);
  return {
    id: share._id.toString(),
    batchId: share.batchId,
    cropName: share.cropName,
    pickupLocation: share.pickupLocation,
    destination: share.destination,
    quantityKg: share.quantityKg,
    estimatedTransportCost: share.estimatedTransportCost,
    dispatchDate: share.dispatchDate,
    expectedDeliveryDate: share.expectedDeliveryDate,
    estimatedDurationDays,
    status: share.status,
    createdAt: share.createdAt
  };
}

router.get("/mine", allowRoles("transporter", "farmer", "trader"), async (req, res, next) => {
  try {
    const queryKey = req.user.role === "transporter" ? "transporter" : "requester";
    const [deliveries, shares] = await Promise.all([
      Delivery.find({ [queryKey]: req.user.id }).sort({ createdAt: -1 }).lean(),
      req.user.role === "transporter"
        ? Promise.resolve([])
        : DeliveryShare.find({ requester: req.user.id }).sort({ createdAt: -1 }).lean()
    ]);
    const summary = {
      pending: deliveries.filter(delivery => delivery.status === "Requested").length,
      active: deliveries.filter(delivery => ["Accepted", "In Transit"].includes(delivery.status)).length,
      completed: deliveries.filter(delivery => delivery.status === "Delivered").length
    };
    res.json({ deliveries: deliveries.map(deliveryView), shares: shares.map(shareView), summary });
  } catch (error) { next(error); }
});

router.get("/requests", allowRoles("transporter"), async (req, res, next) => {
  try {
    const requests = await DeliveryShare.find({ transporter: req.user.id, status: "Requested" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ requests: requests.map(shareView) });
  } catch (error) { next(error); }
});

router.post("/requests", allowRoles("farmer", "trader"), async (req, res, next) => {
  const { batchId, transporterEmail } = req.body || {};
  if (typeof batchId !== "string" || !isValidBatchId(batchId)) {
    return res.status(400).json({ message: "Enter a valid batch ID." });
  }
  const details = validatedRouteDetails(req.body || {});
  if (details.error) return res.status(400).json({ message: details.error });

  try {
    const batch = await Batch.findOne({ batchId, isPublished: true }).select("_id batchId farmer cropName quantityKg");
    if (!batch) return res.status(404).json({ message: "Published batch not found." });
    if (details.value.quantityKg > batch.quantityKg) {
      return res.status(400).json({ message: "Delivery quantity cannot exceed the registered batch quantity." });
    }

    if (req.user.role === "farmer" && batch.farmer.toString() !== req.user.id) {
      return res.status(404).json({ message: "Published batch not found." });
    }
    if (req.user.role === "trader") {
      const acceptedInterest = await PurchaseInterest.exists({
        batch: batch._id,
        trader: req.user.id,
        status: "Accepted"
      });
      if (!acceptedInterest) {
        return res.status(403).json({ message: "Only the trader with an accepted purchase request can request delivery for this batch." });
      }
    }

    const normalizedEmail = typeof transporterEmail === "string" ? transporterEmail.trim().toLowerCase() : "";
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Enter the account email of the transporter to share this request with." });
    }
    const transporter = await User.findOne({ email: normalizedEmail, role: "transporter" }).select("_id");
    if (!transporter) return res.status(404).json({ message: "No transporter account was found for that email." });

    const share = await DeliveryShare.create({
      batch: batch._id,
      batchId: batch.batchId,
      transporter: transporter._id,
      requester: req.user.id,
      cropName: batch.cropName,
      ...details.value
    });
    res.status(201).json({ request: shareView(share), noticeCode: "DELIVERY_REQUEST_SHARED", message: "Delivery request shared with the selected transporter." });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "A delivery request for this batch has already been shared with this transporter." });
    next(error);
  }
});

router.post("/requests/:requestId/respond", allowRoles("transporter"), async (req, res, next) => {
  const { requestId } = req.params;
  const { decision } = req.body || {};
  if (!validObjectId(requestId)) return res.status(400).json({ message: "Enter a valid delivery-request ID." });
  if (!["Accepted", "Rejected"].includes(decision)) {
    return res.status(400).json({ message: "Decision must be Accepted or Rejected." });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const share = await DeliveryShare.findOne({
        _id: requestId,
        transporter: req.user.id,
        status: "Requested"
      }).session(session);
      if (!share) {
        const error = new Error("Delivery request not found or already resolved.");
        error.status = 404;
        throw error;
      }

      if (decision === "Rejected") {
        share.status = "Rejected";
        await share.save({ session });
        result = { request: shareView(share) };
        return;
      }

      const batch = await Batch.findOne({ _id: share.batch, batchId: share.batchId, isPublished: true }).session(session);
      if (!batch) {
        const error = new Error("The linked batch is no longer available.");
        error.status = 409;
        throw error;
      }
      const delivery = await Delivery.create([{
        batch: batch._id,
        batchId: batch.batchId,
        transporter: req.user.id,
        requester: share.requester,
        sourceShare: share._id,
        cropName: batch.cropName,
        pickupLocation: share.pickupLocation,
        destination: share.destination,
        quantityKg: share.quantityKg,
        estimatedTransportCost: share.estimatedTransportCost,
        dispatchDate: share.dispatchDate,
        expectedDeliveryDate: share.expectedDeliveryDate,
        status: "Accepted"
      }], { session });
      share.status = "Accepted";
      share.delivery = delivery[0]._id;
      await share.save({ session });
      result = { delivery: deliveryView(delivery[0]), request: shareView(share) };
    });

    res.json({
      ...result,
      noticeCode: decision === "Accepted" ? "DELIVERY_REQUEST_ACCEPTED" : "DELIVERY_REQUEST_REJECTED",
      message: decision === "Accepted" ? "Delivery request accepted and assigned to you." : "Delivery request declined."
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.post("/", allowRoles("transporter"), async (req, res, next) => {
  const { batchId } = req.body || {};
  if (typeof batchId !== "string" || !isValidBatchId(batchId)) {
    return res.status(400).json({ message: "Enter a valid batch ID." });
  }
  const details = validatedRouteDetails(req.body || {});
  if (details.error) return res.status(400).json({ message: details.error });

  try {
    const batch = await Batch.findOne({ batchId, isPublished: true }).select("_id batchId cropName quantityKg");
    if (!batch) return res.status(404).json({ message: "Published batch not found." });
    if (details.value.quantityKg > batch.quantityKg) {
      return res.status(400).json({ message: "Delivery quantity cannot exceed the registered batch quantity." });
    }
    const delivery = await Delivery.create({
      batch: batch._id,
      batchId: batch.batchId,
      transporter: req.user.id,
      cropName: batch.cropName,
      ...details.value,
      status: "Requested"
    });
    res.status(201).json({ delivery: deliveryView(delivery), noticeCode: "DELIVERY_CREATED", message: "Delivery record created and assigned to you." });
  } catch (error) { next(error); }
});

router.patch("/:deliveryId/status", allowRoles("transporter"), async (req, res, next) => {
  const { deliveryId } = req.params;
  const { status } = req.body || {};
  if (!validObjectId(deliveryId)) return res.status(400).json({ message: "Enter a valid delivery ID." });
  if (!DELIVERY_STATUSES.includes(status)) return res.status(400).json({ message: "Choose a valid delivery status." });

  let session;
  try {
    session = await mongoose.startSession();
    let updatedDelivery;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findOne({ _id: deliveryId, transporter: req.user.id }).session(session);
      if (!delivery) {
        const error = new Error("Delivery record not found.");
        error.status = 404;
        throw error;
      }
      if (!DELIVERY_TRANSITIONS[delivery.status].includes(status)) {
        const error = new Error(`Cannot change delivery status from ${delivery.status} to ${status}.`);
        error.status = 409;
        throw error;
      }

      delivery.status = status;
      delivery.statusUpdatedAt = new Date();
      await delivery.save({ session });
      if (delivery.sourceShare && ["Delivered", "Cancelled"].includes(status)) {
        const share = await DeliveryShare.findOneAndUpdate({
          _id: delivery.sourceShare,
          transporter: req.user.id,
          status: "Accepted"
        }, { $set: { status } }, { new: true, runValidators: true, session });
        if (!share) {
          const error = new Error("The linked delivery request changed. Refresh before updating delivery status.");
          error.status = 409;
          throw error;
        }
      }
      updatedDelivery = delivery;
    });
    res.json({ delivery: deliveryView(updatedDelivery), noticeCode: "DELIVERY_STATUS_UPDATED", message: "Delivery status updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.get("/:deliveryId/progress", allowRoles("transporter", "farmer", "trader"), async (req, res, next) => {
  const { deliveryId } = req.params;
  if (!validObjectId(deliveryId)) return res.status(400).json({ message: "Enter a valid delivery ID." });

  try {
    const filter = { _id: deliveryId };
    if (req.user.role === "transporter") filter.transporter = req.user.id;
    else filter.requester = req.user.id;
    const delivery = await Delivery.findOne(filter).lean();
    if (!delivery) return res.status(404).json({ message: "Delivery progress not found." });
    res.json({
      delivery: {
        batchId: delivery.batchId,
        cropName: delivery.cropName,
        pickupLocation: delivery.pickupLocation,
        destination: delivery.destination,
        quantityKg: delivery.quantityKg,
        dispatchDate: delivery.dispatchDate,
        expectedDeliveryDate: delivery.expectedDeliveryDate,
        estimatedDurationDays: Math.round((new Date(delivery.expectedDeliveryDate) - new Date(delivery.dispatchDate)) / 86400000),
        status: delivery.status,
        statusUpdatedAt: delivery.statusUpdatedAt
      },
      locationNotice: "Pickup and destination are manually entered. GPS tracking and live ETA are not available."
    });
  } catch (error) { next(error); }
});

export default router;

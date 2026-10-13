import { Router } from "express";
import mongoose from "mongoose";
import PurchaseInterest from "../models/PurchaseInterest.js";
import Batch from "../models/Batch.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { isValidBatchId } from "../utils/batchId.js";

const router = Router();

router.use(protect);

router.get("/mine", allowRoles("farmer", "trader"), async (req, res, next) => {
  try {
    const isFarmer = req.user.role === "farmer";
    const query = PurchaseInterest.find({
      [isFarmer ? "farmer" : "trader"]: req.user.id
    })
      .select("batch batchId trader status createdAt")
      .populate({ path: "batch", select: "batchId cropName quantityKg" })
      .sort({ createdAt: -1 });
    if (isFarmer) query.populate({ path: "trader", select: "name" });
    const interests = await query.lean();

    res.json({
      interests: interests.map(interest => ({
        id: interest._id.toString(),
        batchId: interest.batchId,
        cropName: interest.batch?.cropName || "Batch no longer available",
        quantityKg: interest.batch?.quantityKg ?? null,
        status: interest.status,
        createdAt: interest.createdAt,
        ...(isFarmer ? { traderName: interest.trader?.name || "Trader" } : {})
      }))
    });
  } catch (error) { next(error); }
});

router.post("/:batchId", allowRoles("trader"), async (req, res, next) => {
  const { batchId } = req.params;
  if (!isValidBatchId(batchId)) {
    return res.status(400).json({ message: "Enter a valid batch ID." });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let createdInterest;
    await session.withTransaction(async () => {
      const batch = await Batch.findOne({
        batchId,
        isPublished: true,
        status: { $in: ["Available", "Buyer interested"] },
        farmer: { $ne: req.user.id }
      }).session(session);
      if (!batch) {
        const error = new Error("Published batch not found or no longer available.");
        error.status = 404;
        throw error;
      }

      const existing = await PurchaseInterest.findOne({
        batch: batch._id,
        trader: req.user.id
      }).session(session);
      if (existing) {
        const error = new Error("You have already submitted interest for this batch.");
        error.status = 409;
        throw error;
      }

      [createdInterest] = await PurchaseInterest.create([{
        batch: batch._id,
        batchId: batch.batchId,
        farmer: batch.farmer,
        trader: req.user.id
      }], { session });
      batch.status = "Buyer interested";
      batch.statusUpdatedAt = new Date();
      await batch.save({ session });
    });

    res.status(201).json({
      interest: {
        batchId: createdInterest.batchId,
        status: createdInterest.status,
        createdAt: createdInterest.createdAt
      },
      noticeCode: "PURCHASE_INTEREST_SENT",
      message: "Purchase interest sent to the farmer."
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "You have already submitted interest for this batch." });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.patch("/:interestId/respond", allowRoles("farmer"), async (req, res, next) => {
  const { interestId } = req.params;
  const { decision } = req.body || {};
  if (!mongoose.isValidObjectId(interestId)) {
    return res.status(400).json({ message: "Enter a valid purchase-interest ID." });
  }
  if (!["Accepted", "Rejected"].includes(decision)) {
    return res.status(400).json({ message: "Decision must be Accepted or Rejected." });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let updatedInterest;
    await session.withTransaction(async () => {
      const interest = await PurchaseInterest.findOne({
        _id: interestId,
        farmer: req.user.id
      }).session(session);
      if (!interest) {
        const error = new Error("Purchase-interest request not found.");
        error.status = 404;
        throw error;
      }
      if (interest.status !== "Pending") {
        const error = new Error("This request has already been resolved.");
        error.status = 409;
        throw error;
      }

      const batch = await Batch.findOne({
        _id: interest.batch,
        farmer: req.user.id,
        isPublished: true,
        status: { $in: ["Available", "Buyer interested"] }
      }).session(session);
      if (!batch) {
        const error = new Error("This batch is no longer available for request decisions.");
        error.status = 409;
        throw error;
      }

      interest.status = decision;
      await interest.save({ session });

      if (decision === "Accepted") {
        batch.status = "Sold";
        batch.statusUpdatedAt = new Date();
        await batch.save({ session });
        await PurchaseInterest.updateMany(
          { batch: batch._id, _id: { $ne: interest._id }, status: "Pending" },
          { $set: { status: "Rejected" } },
          { session }
        );
      } else {
        const pendingCount = await PurchaseInterest.countDocuments({
          batch: batch._id,
          status: "Pending"
        }).session(session);
        batch.status = pendingCount > 0 ? "Buyer interested" : "Available";
        batch.statusUpdatedAt = new Date();
        await batch.save({ session });
      }
      updatedInterest = interest;
    });

    res.json({
      interest: {
        id: updatedInterest._id.toString(),
        batchId: updatedInterest.batchId,
        status: updatedInterest.status
      },
      noticeCode: decision === "Accepted" ? "PURCHASE_INTEREST_ACCEPTED" : "PURCHASE_INTEREST_REJECTED",
      message: `Purchase interest ${decision.toLowerCase()}.`
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

export default router;

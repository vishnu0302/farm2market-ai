import { Router } from "express";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import { diagnoseMandiApi, fetchMandiPrices, MandiPriceError } from "../services/mandiPriceService.js";
import { getMandiLocationSnapshot } from "../services/mandiLocationService.js";

const router = Router();

router.get("/locations", protect, allowRoles("farmer"), async (req, res, next) => {
  try {
    res.json(await getMandiLocationSnapshot());
  } catch (error) {
    if (error instanceof MandiPriceError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    next(error);
  }
});

router.get("/status", protect, allowRoles("farmer"), async (_req, res, next) => {
  try {
    res.json(await diagnoseMandiApi());
  } catch (error) {
    next(error);
  }
});

router.get("/mandi-prices", protect, allowRoles("farmer"), async (req, res, next) => {
  try {
    const result = await fetchMandiPrices({
      commodity: req.query.commodity,
      state: req.query.state,
      district: req.query.district,
      market: req.query.market,
      variety: req.query.variety,
      reportDate: req.query.reportDate
    }, {
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json(result);
  } catch (error) {
    if (error instanceof MandiPriceError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    next(error);
  }
});

export default router;

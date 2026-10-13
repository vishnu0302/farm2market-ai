import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import interestRoutes from "./routes/interestRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import deliveryRoutes from "./routes/deliveryRoutes.js";
import riskAlertRoutes from "./routes/riskAlertRoutes.js";
import marketRoutes from "./routes/marketRoutes.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import { addApiErrorCode } from "./middleware/apiErrorCodes.js";

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use(addApiErrorCode);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Farm2Market AI API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/interests", interestRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/alerts", riskAlertRoutes);
app.use("/api/market", marketRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;

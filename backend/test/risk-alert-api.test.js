import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "risk-alert-test-secret-with-at-least-32-chars";
  replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replSet.getUri());

  const app = (await import("../src/app.js")).default;
  const { default: Batch } = await import("../src/models/Batch.js");
  const { default: Delivery } = await import("../src/models/Delivery.js");
  const { default: PurchaseInterest } = await import("../src/models/PurchaseInterest.js");
  const { default: RiskAlertAcknowledgment } = await import("../src/models/RiskAlertAcknowledgment.js");
  const { default: StorageFacility } = await import("../src/models/StorageFacility.js");
  const { default: WarehouseInventory } = await import("../src/models/WarehouseInventory.js");
  await Promise.all([
    Batch.init(),
    Delivery.init(),
    PurchaseInterest.init(),
    RiskAlertAcknowledgment.init(),
    StorageFacility.init(),
    WarehouseInventory.init()
  ]);

  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

async function api(path, { token, method = "GET" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: response.status, data: await response.json() };
}

async function signup(name, role) {
  const result = await fetch(`${baseUrl}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@risk.test`,
      password: "risk-alert-test-password",
      role
    })
  });
  const data = await result.json();
  assert.equal(result.status, 201);
  return data;
}

test("risk dashboard scopes batches by role and persists per-user acknowledgments", async () => {
  const farmer = await signup("Risk Farmer", "farmer");
  const unrelatedFarmer = await signup("Other Risk Farmer", "farmer");
  const trader = await signup("Risk Trader", "trader");
  const unrelatedTrader = await signup("Other Risk Trader", "trader");
  const warehouse = await signup("Risk Warehouse", "warehouse");
  const unrelatedWarehouse = await signup("Other Risk Warehouse", "warehouse");
  const transporter = await signup("Risk Transporter", "transporter");
  const unrelatedTransporter = await signup("Other Risk Transporter", "transporter");

  const now = new Date();
  const dateDaysAgo = days => new Date(now.getTime() - days * 86400000);
  const batchId = `FM-${now.toISOString().slice(0, 10).replaceAll("-", "")}-A1B2C3`;
  const batch = await mongoose.model("Batch").create({
    batchId,
    farmer: farmer.user.id,
    farmerName: farmer.user.name,
    cropName: "Tomato",
    quantityKg: 500,
    harvestDate: dateDaysAgo(20),
    farmLocation: "Private farm location",
    marketName: "Demo market",
    estimatedPricePerKg: 10,
    estimatedGross: 5000,
    transportCost: 20,
    handlingCost: 10,
    estimatedNet: 4970,
    isPublished: true,
    status: "Available"
  });

  await mongoose.model("PurchaseInterest").create({
    batch: batch._id,
    batchId,
    farmer: farmer.user.id,
    trader: trader.user.id,
    status: "Accepted"
  });
  const facility = await mongoose.model("StorageFacility").create({
    warehouse: warehouse.user.id,
    name: "Risk test store",
    location: "Test village",
    capacityKg: 1000,
    usedCapacityKg: 100,
    supportedCropTypes: ["tomato"]
  });
  await mongoose.model("WarehouseInventory").create({
    facility: facility._id,
    warehouse: warehouse.user.id,
    batch: batch._id,
    batchId,
    cropName: "Tomato",
    receivedQuantityKg: 100,
    storedQuantityKg: 100,
    storageType: "Ambient",
    storageDate: dateDaysAgo(15),
    status: "Stored"
  });
  await mongoose.model("Delivery").create({
    batch: batch._id,
    batchId,
    transporter: transporter.user.id,
    requester: farmer.user.id,
    cropName: "Tomato",
    pickupLocation: "Test village",
    destination: "Test market",
    quantityKg: 100,
    estimatedTransportCost: 250,
    dispatchDate: dateDaysAgo(3),
    expectedDeliveryDate: dateDaysAgo(2),
    status: "In Transit",
    statusUpdatedAt: dateDaysAgo(1)
  });

  assert.equal((await api("/alerts")).status, 401);
  const farmerDashboard = await api("/alerts", { token: farmer.token });
  const traderDashboard = await api("/alerts", { token: trader.token });
  const warehouseDashboard = await api("/alerts", { token: warehouse.token });
  const transporterDashboard = await api("/alerts", { token: transporter.token });
  for (const dashboard of [farmerDashboard, traderDashboard, warehouseDashboard, transporterDashboard]) {
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.risks.length, 1);
    assert.equal(dashboard.data.risks[0].batchId, batchId);
    assert.equal(dashboard.data.notice.includes("not a scientifically validated"), true);
  }
  assert.equal(farmerDashboard.data.risks[0].level, "Insufficient data");
  assert.equal(traderDashboard.data.risks[0].level, "Insufficient data");
  assert.equal(warehouseDashboard.data.risks[0].level, "High");
  assert.equal(transporterDashboard.data.risks[0].level, "Insufficient data");
  assert.ok(farmerDashboard.data.alerts.some(alert => alert.type === "delayed-delivery"));
  assert.equal(traderDashboard.data.alerts.some(alert => alert.type === "delayed-delivery"), false);
  assert.equal(warehouseDashboard.data.alerts.some(alert => alert.type === "delayed-delivery"), false);
  assert.ok(transporterDashboard.data.alerts.some(alert => alert.type === "delayed-delivery"));
  assert.equal(warehouseDashboard.data.alerts.some(alert => alert.type === "long-storage"), true);
  assert.equal(JSON.stringify(farmerDashboard.data).includes("Private farm location"), false);
  for (const account of [unrelatedFarmer, unrelatedTrader, unrelatedWarehouse, unrelatedTransporter]) {
    const unrelated = await api("/alerts", { token: account.token });
    assert.equal(unrelated.status, 200);
    assert.deepEqual(unrelated.data.risks, []);
    assert.deepEqual(unrelated.data.alerts, []);
  }

  const targetAlert = farmerDashboard.data.alerts.find(alert => alert.type === "delayed-delivery");
  const acknowledged = await api(`/alerts/${targetAlert.key}/acknowledge`, {
    token: farmer.token,
    method: "POST"
  });
  assert.equal(acknowledged.status, 200);
  const refreshed = await api("/alerts", { token: farmer.token });
  assert.ok(refreshed.data.alerts.find(alert => alert.key === targetAlert.key).acknowledgedAt);

  const unauthorizedAck = await api(`/alerts/${targetAlert.key}/acknowledge`, {
    token: unrelatedFarmer.token,
    method: "POST"
  });
  assert.equal(unauthorizedAck.status, 404);
  const invalidAck = await api("/alerts/not-a-key/acknowledge", { token: farmer.token, method: "POST" });
  assert.equal(invalidAck.status, 400);
});

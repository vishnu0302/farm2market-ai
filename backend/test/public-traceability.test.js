import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { buildPublicTraceability, isValidPublicTraceabilityId } from "../src/services/traceabilityService.js";

let replSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "traceability-test-secret-with-at-least-32-chars";
  replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replSet.getUri());

  const app = (await import("../src/app.js")).default;
  const { default: Batch } = await import("../src/models/Batch.js");
  const { default: Delivery } = await import("../src/models/Delivery.js");
  const { default: WarehouseInventory } = await import("../src/models/WarehouseInventory.js");
  await Promise.all([Batch.init(), Delivery.init(), WarehouseInventory.init()]);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

async function api(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, data: await response.json() };
}

async function signup(name, role) {
  const result = await api("/auth/signup", {
    method: "POST",
    body: {
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@trace.test`,
      password: "traceability-test-password",
      role
    }
  });
  assert.equal(result.status, 201);
  return result.data.token;
}

async function createBatch(farmerToken, location = "Test farm location") {
  const result = await api("/batches", {
    token: farmerToken,
    method: "POST",
    body: {
      cropName: "Tomato",
      quantityKg: 250,
      harvestDate: "2026-10-01",
      farmLocation: location,
      marketIndex: 0,
      transportCost: 50,
      handlingCost: 20,
      otherCosts: 0
    }
  });
  assert.equal(result.status, 201);
  return result.data.batch;
}

test("existing batch IDs validate as stable public traceability IDs", () => {
  assert.equal(isValidPublicTraceabilityId("FM-20261011-A1B2C3"), true);
  assert.equal(isValidPublicTraceabilityId("FM-20260230-A1B2C3"), false);
  assert.equal(isValidPublicTraceabilityId("FM-20261011-12345Z"), false);
  assert.equal(isValidPublicTraceabilityId("not-a-batch"), false);
  assert.equal(isValidPublicTraceabilityId(null), false);
});

test("public DTO handles missing fields and excludes internal and private properties", () => {
  const dto = buildPublicTraceability({
    batchId: "FM-20261011-A1B2C3",
    cropName: null,
    quantityKg: undefined,
    harvestDate: null,
    farmLocation: null,
    status: "Available",
    farmerName: "Private Farmer Name",
    farmer: "private-account-id",
    _id: "internal-database-id",
    createdAt: null,
    updatedAt: null
  });
  assert.equal(dto.traceabilityId, "FM-20261011-A1B2C3");
  assert.equal(dto.cropName, null);
  assert.equal(dto.originLocation, null);
  assert.equal(dto.quantityKg, null);
  assert.equal(dto.harvestDate, null);
  assert.equal(dto.latestStatus, "Available");
  assert.equal(Object.hasOwn(dto, "farmer"), false);
  assert.equal(Object.hasOwn(dto, "farmerName"), false);
  assert.equal(Object.hasOwn(dto, "_id"), false);
});

test("public lookup preserves existing URLs, refreshes current facts, and exposes only recorded allowlisted data", async () => {
  const farmerToken = await signup("Trace Farmer", "farmer");
  const traderToken = await signup("Trace Trader", "trader");
  const farmerBatch = await createBatch(farmerToken);
  const batchId = farmerBatch.batchId;

  const invalidId = await api("/batches/public/FM-20260230-A1B2C3");
  assert.equal(invalidId.status, 400);
  const unknownId = await api("/batches/public/FM-20261011-ABCDEF");
  assert.equal(unknownId.status, 404);

  const draftLookup = await api(`/batches/public/${batchId}`);
  assert.equal(draftLookup.status, 200);
  assert.equal(draftLookup.data.batch.traceabilityId, batchId);
  assert.equal(draftLookup.data.batch.latestStatus, "Draft");
  assert.equal(draftLookup.data.batch.originLocation, "Test farm location");

  const unauthorizedPublish = await api(`/batches/${batchId}/publish`, {
    token: traderToken,
    method: "PATCH"
  });
  assert.equal(unauthorizedPublish.status, 403);

  const secretValues = JSON.stringify(draftLookup.data);
  for (const forbiddenField of ["farmerName", "farmer", "password", "passwordHash", "email", "token", "_id", "id"]) {
    assert.equal(Object.hasOwn(draftLookup.data.batch, forbiddenField), false);
  }
  assert.equal(secretValues.includes(traderToken), false);

  const Batch = mongoose.model("Batch");
  const storedBatch = await Batch.findOne({ batchId }).select("_id");
  await mongoose.model("WarehouseInventory").create({
    facility: new mongoose.Types.ObjectId(),
    warehouse: new mongoose.Types.ObjectId(),
    batch: storedBatch._id,
    batchId,
    cropName: "Tomato",
    receivedQuantityKg: 100,
    storedQuantityKg: 80,
    dispatchedQuantityKg: 20,
    storageType: "Cold",
    storageDate: new Date("2026-10-03T00:00:00.000Z"),
    status: "Partially Dispatched",
    lastDispatchedAt: new Date("2026-10-05T00:00:00.000Z")
  });
  await mongoose.model("Delivery").create({
    batch: storedBatch._id,
    batchId,
    transporter: new mongoose.Types.ObjectId(),
    cropName: "Tomato",
    pickupLocation: "Private pickup location",
    destination: "Private destination",
    quantityKg: 50,
    estimatedTransportCost: 250,
    dispatchDate: new Date("2026-10-05T00:00:00.000Z"),
    expectedDeliveryDate: new Date("2026-10-07T00:00:00.000Z"),
    status: "In Transit",
    statusUpdatedAt: new Date("2026-10-06T00:00:00.000Z")
  });

  const published = await api(`/batches/${batchId}/publish`, { token: farmerToken, method: "PATCH" });
  assert.equal(published.status, 200);
  const updatedLookup = await api(`/batches/public/${batchId}`);
  assert.equal(updatedLookup.status, 200);
  assert.equal(updatedLookup.data.batch.latestStatus, "Available");
  assert.ok(updatedLookup.data.batch.milestones.some(item => item.type === "storage-status" && item.label.includes("Partially Dispatched")));
  assert.ok(updatedLookup.data.batch.milestones.some(item => item.type === "storage-dispatch"));
  assert.ok(updatedLookup.data.batch.milestones.some(item => item.type === "delivery-status" && item.label.includes("In Transit")));
  const serialized = JSON.stringify(updatedLookup.data);
  assert.equal(serialized.includes("Private pickup location"), false);
  assert.equal(serialized.includes("Private destination"), false);
  assert.equal(serialized.includes(traderToken), false);

  await Batch.collection.updateOne({ batchId }, { $unset: { farmLocation: "" } });
  const missingOrigin = await api(`/batches/public/${batchId}`);
  assert.equal(missingOrigin.status, 200);
  assert.equal(missingOrigin.data.batch.originLocation, null);
});

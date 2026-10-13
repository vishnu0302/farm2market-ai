import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "delivery-test-secret-with-at-least-32-chars";
  replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replSet.getUri());

  const app = (await import("../src/app.js")).default;
  const { default: Batch } = await import("../src/models/Batch.js");
  const { default: Delivery } = await import("../src/models/Delivery.js");
  const { default: DeliveryShare } = await import("../src/models/DeliveryShare.js");
  await Promise.all([Batch.init(), Delivery.init(), DeliveryShare.init()]);

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
      ...(token ? { Authorization: "Bearer " + token } : {})
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
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.test`,
      password: "delivery-test-password",
      role
    }
  });
  assert.equal(result.status, 201);
  return result.data.token;
}

async function createPublishedBatch(farmerToken) {
  const created = await api("/batches", {
    token: farmerToken,
    method: "POST",
    body: {
      cropName: "Tomato",
      quantityKg: 500,
      harvestDate: new Date().toISOString().slice(0, 10),
      farmLocation: "Test farm",
      marketIndex: 0,
      transportCost: 25,
      handlingCost: 10,
      otherCosts: 0
    }
  });
  assert.equal(created.status, 201);
  const published = await api(`/batches/${created.data.batch.batchId}/publish`, {
    token: farmerToken,
    method: "PATCH"
  });
  assert.equal(published.status, 200);
  return created.data.batch.batchId;
}

function deliveryDetails(batchId) {
  const today = new Date().toISOString().slice(0, 10);
  const expectedDeliveryDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return {
    batchId,
    pickupLocation: "Test village",
    destination: "Test market",
    quantityKg: 100,
    estimatedTransportCost: 250,
    dispatchDate: today,
    expectedDeliveryDate
  };
}

test("delivery sharing, assignment, status transitions and access are role-scoped", async () => {
  const farmerToken = await signup("Delivery Farmer", "farmer");
  const otherFarmerToken = await signup("Other Delivery Farmer", "farmer");
  const transporterToken = await signup("Delivery Transporter", "transporter");
  const otherTransporterToken = await signup("Other Delivery Transporter", "transporter");
  const warehouseToken = await signup("Delivery Warehouse", "warehouse");
  const batchId = await createPublishedBatch(farmerToken);

  const forbiddenRequests = await api("/deliveries/requests", { token: farmerToken });
  assert.equal(forbiddenRequests.status, 403);

  const invalidRequest = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: { ...deliveryDetails(batchId), transporterEmail: "delivery.transporter@example.test", quantityKg: 0 }
  });
  assert.equal(invalidRequest.status, 400);

  const invalidDate = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: { ...deliveryDetails(batchId), transporterEmail: "delivery.transporter@example.test", expectedDeliveryDate: "2020-01-01" }
  });
  assert.equal(invalidDate.status, 400);

  const shareResult = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: { ...deliveryDetails(batchId), transporterEmail: "delivery.transporter@example.test" }
  });
  assert.equal(shareResult.status, 201);
  assert.equal(shareResult.data.request.status, "Requested");
  assert.equal(Object.hasOwn(shareResult.data.request, "requester"), false);

  const duplicateShare = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: { ...deliveryDetails(batchId), transporterEmail: "delivery.transporter@example.test" }
  });
  assert.equal(duplicateShare.status, 409);

  const pendingMine = await api("/deliveries/mine", { token: farmerToken });
  assert.equal(pendingMine.status, 200);
  assert.equal(pendingMine.data.shares.length, 1);
  assert.equal(pendingMine.data.shares[0].status, "Requested");

  const transporterRequests = await api("/deliveries/requests", { token: transporterToken });
  assert.equal(transporterRequests.status, 200);
  assert.equal(transporterRequests.data.requests.length, 1);
  assert.equal(Object.hasOwn(transporterRequests.data.requests[0], "requester"), false);
  const hiddenRequests = await api("/deliveries/requests", { token: otherTransporterToken });
  assert.equal(hiddenRequests.data.requests.length, 0);

  const accepted = await api(`/deliveries/requests/${shareResult.data.request.id}/respond`, {
    token: otherTransporterToken,
    method: "POST",
    body: { decision: "Accepted" }
  });
  assert.equal(accepted.status, 404);

  const acceptedDelivery = await api(`/deliveries/requests/${shareResult.data.request.id}/respond`, {
    token: transporterToken,
    method: "POST",
    body: { decision: "Accepted" }
  });
  assert.equal(acceptedDelivery.status, 200);
  assert.equal(acceptedDelivery.data.delivery.status, "Accepted");
  const deliveryId = acceptedDelivery.data.delivery.id;

  const otherOwnerUpdate = await api(`/deliveries/${deliveryId}/status`, {
    token: otherTransporterToken,
    method: "PATCH",
    body: { status: "In Transit" }
  });
  assert.equal(otherOwnerUpdate.status, 404);

  const invalidTransition = await api(`/deliveries/${deliveryId}/status`, {
    token: transporterToken,
    method: "PATCH",
    body: { status: "Delivered" }
  });
  assert.equal(invalidTransition.status, 409);

  for (const status of ["In Transit", "Delivered"]) {
    const update = await api(`/deliveries/${deliveryId}/status`, {
      token: transporterToken,
      method: "PATCH",
      body: { status }
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.delivery.status, status);
  }

  const farmerProgress = await api(`/deliveries/${deliveryId}/progress`, { token: farmerToken });
  assert.equal(farmerProgress.status, 200);
  assert.equal(farmerProgress.data.delivery.status, "Delivered");
  assert.equal(Object.hasOwn(farmerProgress.data.delivery, "transporter"), false);
  const otherFarmerProgress = await api(`/deliveries/${deliveryId}/progress`, { token: otherFarmerToken });
  assert.equal(otherFarmerProgress.status, 404);
  const warehouseProgress = await api(`/deliveries/${deliveryId}/progress`, { token: warehouseToken });
  assert.equal(warehouseProgress.status, 403);

  const ownRecord = await api("/deliveries", {
    token: transporterToken,
    method: "POST",
    body: deliveryDetails(batchId)
  });
  assert.equal(ownRecord.status, 201);
  assert.equal(ownRecord.data.delivery.status, "Requested");

  const wrongRoleCreate = await api("/deliveries", {
    token: farmerToken,
    method: "POST",
    body: deliveryDetails(batchId)
  });
  assert.equal(wrongRoleCreate.status, 403);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
  replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replSet.getUri());

  const app = (await import("../src/app.js")).default;
  const { default: Batch } = await import("../src/models/Batch.js");
  const { default: PurchaseInterest } = await import("../src/models/PurchaseInterest.js");
  await Promise.all([Batch.init(), PurchaseInterest.init()]);

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
      email: `${name.toLowerCase()}@example.test`,
      password: "test-password-123",
      role
    }
  });
  assert.equal(result.status, 201);
  return result.data.token;
}

async function createBatch(farmerToken, cropName) {
  const result = await api("/batches", {
    token: farmerToken,
    method: "POST",
    body: {
      cropName,
      quantityKg: 250,
      harvestDate: new Date().toISOString().slice(0, 10),
      farmLocation: "Test farm location",
      marketIndex: 0,
      transportCost: 50,
      handlingCost: 20,
      otherCosts: 0
    }
  });
  assert.equal(result.status, 201);
  return result.data.batch;
}

test("farmer publishes batches, trader requests interest, farmer accepts or rejects", async () => {
  const farmerToken = await signup("Workflow Farmer", "farmer");
  const traderToken = await signup("Workflow Trader", "trader");
  const otherFarmerToken = await signup("Other Farmer", "farmer");

  const acceptedBatch = await createBatch(farmerToken, "Tomato");
  assert.equal(acceptedBatch.status, "Draft");
  assert.equal(acceptedBatch.isPublished, false);

  const unpublishedMarketplace = await api("/batches/marketplace", { token: traderToken });
  assert.equal(unpublishedMarketplace.status, 200);
  assert.equal(unpublishedMarketplace.data.batches.length, 0);

  const traderPublishAttempt = await api(`/batches/${acceptedBatch.batchId}/publish`, {
    token: traderToken,
    method: "PATCH"
  });
  assert.equal(traderPublishAttempt.status, 403);

  const otherFarmerPublishAttempt = await api(`/batches/${acceptedBatch.batchId}/publish`, {
    token: otherFarmerToken,
    method: "PATCH"
  });
  assert.equal(otherFarmerPublishAttempt.status, 404);

  const published = await api(`/batches/${acceptedBatch.batchId}/publish`, {
    token: farmerToken,
    method: "PATCH"
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.batch.status, "Available");
  assert.equal(published.data.batch.isPublished, true);

  const duplicatePublish = await api(`/batches/${acceptedBatch.batchId}/publish`, {
    token: farmerToken,
    method: "PATCH"
  });
  assert.equal(duplicatePublish.status, 409);

  const visibleBatches = await api("/batches/marketplace", { token: traderToken });
  assert.equal(visibleBatches.status, 200);
  assert.equal(visibleBatches.data.batches.length, 1);
  assert.equal(visibleBatches.data.batches[0].batchId, acceptedBatch.batchId);
  assert.equal("farmerName" in visibleBatches.data.batches[0], false);
  assert.equal("farmLocation" in visibleBatches.data.batches[0], false);

  const submitted = await api(`/interests/${acceptedBatch.batchId}`, {
    token: traderToken,
    method: "POST"
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.interest.status, "Pending");

  const farmerRequestAttempt = await api(`/interests/${acceptedBatch.batchId}`, {
    token: farmerToken,
    method: "POST"
  });
  assert.equal(farmerRequestAttempt.status, 403);

  const duplicate = await api(`/interests/${acceptedBatch.batchId}`, {
    token: traderToken,
    method: "POST"
  });
  assert.equal(duplicate.status, 409);

  const farmerRequests = await api("/interests/mine", { token: farmerToken });
  assert.equal(farmerRequests.status, 200);
  assert.equal(farmerRequests.data.interests.length, 1);
  const acceptedRequest = farmerRequests.data.interests[0];
  assert.equal(acceptedRequest.status, "Pending");

  const unauthorizedDecision = await api(`/interests/${acceptedRequest.id}/respond`, {
    token: otherFarmerToken,
    method: "PATCH",
    body: { decision: "Accepted" }
  });
  assert.equal(unauthorizedDecision.status, 404);

  const traderDecisionAttempt = await api(`/interests/${acceptedRequest.id}/respond`, {
    token: traderToken,
    method: "PATCH",
    body: { decision: "Accepted" }
  });
  assert.equal(traderDecisionAttempt.status, 403);

  const invalidDecision = await api(`/interests/${acceptedRequest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Pending" }
  });
  assert.equal(invalidDecision.status, 400);

  const accepted = await api(`/interests/${acceptedRequest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Accepted" }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.interest.status, "Accepted");
  const repeatedDecision = await api(`/interests/${acceptedRequest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Rejected" }
  });
  assert.equal(repeatedDecision.status, 409);

  const soldMarketplace = await api("/batches/marketplace", { token: traderToken });
  assert.equal(soldMarketplace.data.batches.length, 0);
  const ownerBatches = await api("/batches", { token: farmerToken });
  assert.equal(ownerBatches.data.batches.find(batch => batch.batchId === acceptedBatch.batchId).status, "Sold");

  const rejectedBatch = await createBatch(farmerToken, "Onion");
  await api(`/batches/${rejectedBatch.batchId}/publish`, { token: farmerToken, method: "PATCH" });
  const rejectionRequest = await api(`/interests/${rejectedBatch.batchId}`, {
    token: traderToken,
    method: "POST"
  });
  assert.equal(rejectionRequest.status, 201);

  const requestList = await api("/interests/mine", { token: farmerToken });
  const pendingRequest = requestList.data.interests.find(interest => interest.batchId === rejectedBatch.batchId);
  const rejected = await api(`/interests/${pendingRequest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Rejected" }
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.interest.status, "Rejected");

  const availableMarketplace = await api("/batches/marketplace", { token: traderToken });
  assert.equal(availableMarketplace.data.batches.length, 1);
  assert.equal(availableMarketplace.data.batches[0].batchId, rejectedBatch.batchId);
});

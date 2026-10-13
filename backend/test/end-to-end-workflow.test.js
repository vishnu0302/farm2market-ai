import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replicaSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "end-to-end-test-secret-with-at-least-32-characters";
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replicaSet.getUri());

  const app = (await import("../src/app.js")).default;
  const modelPaths = [
    "../src/models/Batch.js",
    "../src/models/PurchaseInterest.js",
    "../src/models/StorageFacility.js",
    "../src/models/WarehouseInventory.js",
    "../src/models/Delivery.js",
    "../src/models/DeliveryShare.js"
  ];
  const models = await Promise.all(modelPaths.map(path => import(path)));
  await Promise.all(models.map(({ default: Model }) => Model.init()));

  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
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
      email: `${name.toLowerCase().replaceAll(" ", ".")}@workflow.test`,
      password: "workflow-test-password",
      role
    }
  });
  assert.equal(result.status, 201);
  return result.data.token;
}

async function createBatch(farmerToken) {
  const result = await api("/batches", {
    token: farmerToken,
    method: "POST",
    body: {
      cropName: "Tomato",
      quantityKg: 500,
      harvestDate: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
      farmLocation: "Workflow farm",
      marketIndex: 0,
      transportCost: 50,
      handlingCost: 20,
      otherCosts: 15
    }
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.batch.estimatedGross, 9000);
  assert.equal(result.data.batch.estimatedNet, 8915);
  return result.data.batch;
}

function deliveryDetails(batchId, transporterEmail) {
  const today = new Date().toISOString().slice(0, 10);
  const expectedDeliveryDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return {
    batchId,
    transporterEmail,
    pickupLocation: "Workflow farm",
    destination: "Regional produce market",
    quantityKg: 75,
    estimatedTransportCost: 225,
    dispatchDate: today,
    expectedDeliveryDate
  };
}

test("farmer, trader, warehouse, and transporter records form one authorized traceable workflow", async () => {
  const farmerToken = await signup("Workflow Farmer", "farmer");
  const traderToken = await signup("Workflow Trader", "trader");
  const otherFarmerToken = await signup("Other Workflow Farmer", "farmer");
  const warehouseToken = await signup("Workflow Warehouse", "warehouse");
  const otherWarehouseToken = await signup("Other Workflow Warehouse", "warehouse");
  const rejectingTransporterToken = await signup("Rejecting Workflow Transporter", "transporter");
  const assignedTransporterToken = await signup("Assigned Workflow Transporter", "transporter");
  const batch = await createBatch(farmerToken);

  const published = await api(`/batches/${batch.batchId}/publish`, { token: farmerToken, method: "PATCH" });
  assert.equal(published.status, 200);
  assert.equal(published.data.batch.status, "Available");

  const traderListing = await api("/batches/marketplace", { token: traderToken });
  assert.equal(traderListing.status, 200);
  assert.ok(traderListing.data.batches.some(item => item.batchId === batch.batchId));
  const submittedInterest = await api(`/interests/${batch.batchId}`, { token: traderToken, method: "POST" });
  assert.equal(submittedInterest.status, 201);
  assert.equal(submittedInterest.data.interest.status, "Pending");
  const unacceptedTraderDelivery = await api("/deliveries/requests", {
    token: traderToken,
    method: "POST",
    body: deliveryDetails(batch.batchId, "assigned.workflow.transporter@workflow.test")
  });
  assert.equal(unacceptedTraderDelivery.status, 403);

  const farmerRequests = await api("/interests/mine", { token: farmerToken });
  const interest = farmerRequests.data.interests.find(item => item.batchId === batch.batchId);
  assert.ok(interest);
  const acceptedInterest = await api(`/interests/${interest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Accepted" }
  });
  assert.equal(acceptedInterest.status, 200);
  assert.equal(acceptedInterest.data.interest.status, "Accepted");
  const traderDecision = await api("/interests/mine", { token: traderToken });
  assert.equal(traderDecision.data.interests.find(item => item.batchId === batch.batchId).status, "Accepted");

  const rejectedBatch = await createBatch(farmerToken);
  const prematureStoragePermission = await api(`/batches/${rejectedBatch.batchId}/warehouse-authorization`, {
    token: farmerToken,
    method: "PATCH",
    body: { authorized: true }
  });
  assert.equal(prematureStoragePermission.status, 409);
  assert.equal((await api(`/batches/${rejectedBatch.batchId}/publish`, { token: farmerToken, method: "PATCH" })).status, 200);
  assert.equal((await api(`/interests/${rejectedBatch.batchId}`, { token: traderToken, method: "POST" })).status, 201);
  const rejectedInterestRequest = await api("/interests/mine", { token: farmerToken });
  const pendingRejectedInterest = rejectedInterestRequest.data.interests.find(item => item.batchId === rejectedBatch.batchId);
  const rejectedInterest = await api(`/interests/${pendingRejectedInterest.id}/respond`, {
    token: farmerToken,
    method: "PATCH",
    body: { decision: "Rejected" }
  });
  assert.equal(rejectedInterest.status, 200);
  assert.equal(rejectedInterest.data.interest.status, "Rejected");
  const traderRejectedStatus = await api("/interests/mine", { token: traderToken });
  assert.equal(traderRejectedStatus.data.interests.find(item => item.batchId === rejectedBatch.batchId).status, "Rejected");

  const facility = await api("/warehouses/facilities", {
    token: warehouseToken,
    method: "POST",
    body: { name: "Workflow store", location: "Workflow village", capacityKg: 200, supportedCropTypes: ["tomato"] }
  });
  assert.equal(facility.status, 201);
  const facilityId = facility.data.facility.id;
  const intakeBody = {
    batchId: batch.batchId,
    quantityKg: 100,
    storageType: "Cold",
    storageDate: new Date().toISOString().slice(0, 10)
  };
  const notYetAuthorized = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: intakeBody
  });
  assert.equal(notYetAuthorized.status, 404);

  const unauthorizedPermission = await api(`/batches/${batch.batchId}/warehouse-authorization`, {
    token: otherWarehouseToken,
    method: "PATCH",
    body: { authorized: true }
  });
  assert.equal(unauthorizedPermission.status, 403);
  const otherFarmersPermission = await api(`/batches/${batch.batchId}/warehouse-authorization`, {
    token: otherFarmerToken,
    method: "PATCH",
    body: { authorized: true }
  });
  assert.equal(otherFarmersPermission.status, 404);
  const authorization = await api(`/batches/${batch.batchId}/warehouse-authorization`, {
    token: farmerToken,
    method: "PATCH",
    body: { authorized: true }
  });
  assert.equal(authorization.status, 200);
  const intake = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: intakeBody
  });
  assert.equal(intake.status, 201);
  assert.equal(intake.data.inventory.batchId, batch.batchId);
  const warehouseStatus = await api(`/warehouses/facilities/${facilityId}/inventory/${intake.data.inventory.id}/status`, {
    token: warehouseToken,
    method: "PATCH",
    body: { status: "Quality Check" }
  });
  assert.equal(warehouseStatus.status, 200);
  const unauthorizedStatusChange = await api(`/warehouses/facilities/${facilityId}/inventory/${intake.data.inventory.id}/status`, {
    token: otherWarehouseToken,
    method: "PATCH",
    body: { status: "Spoiled" }
  });
  assert.equal(unauthorizedStatusChange.status, 404);
  const prematureRevocation = await api(`/batches/${batch.batchId}/warehouse-authorization`, {
    token: farmerToken,
    method: "PATCH",
    body: { authorized: false }
  });
  assert.equal(prematureRevocation.status, 409);

  const unauthorizedInventory = await api(`/warehouses/facilities/${facilityId}/inventory`, { token: otherWarehouseToken });
  assert.equal(unauthorizedInventory.status, 404);

  const rejectedShare = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: deliveryDetails(batch.batchId, "rejecting.workflow.transporter@workflow.test")
  });
  assert.equal(rejectedShare.status, 201);
  const rejectingRequests = await api("/deliveries/requests", { token: rejectingTransporterToken });
  assert.equal(rejectingRequests.data.requests.length, 1);
  const rejected = await api(`/deliveries/requests/${rejectedShare.data.request.id}/respond`, {
    token: rejectingTransporterToken,
    method: "POST",
    body: { decision: "Rejected" }
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.request.status, "Rejected");

  const shared = await api("/deliveries/requests", {
    token: farmerToken,
    method: "POST",
    body: deliveryDetails(batch.batchId, "assigned.workflow.transporter@workflow.test")
  });
  assert.equal(shared.status, 201);
  const assignedRequests = await api("/deliveries/requests", { token: assignedTransporterToken });
  assert.equal(assignedRequests.status, 200);
  assert.equal(assignedRequests.data.requests.length, 1);
  const acceptedDelivery = await api(`/deliveries/requests/${shared.data.request.id}/respond`, {
    token: assignedTransporterToken,
    method: "POST",
    body: { decision: "Accepted" }
  });
  assert.equal(acceptedDelivery.status, 200);
  const deliveryId = acceptedDelivery.data.delivery.id;
  for (const status of ["In Transit", "Delivered"]) {
    const updated = await api(`/deliveries/${deliveryId}/status`, {
      token: assignedTransporterToken,
      method: "PATCH",
      body: { status }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.delivery.status, status);
  }

  const outOfScopeUpdate = await api(`/deliveries/${deliveryId}/status`, {
    token: rejectingTransporterToken,
    method: "PATCH",
    body: { status: "Cancelled" }
  });
  assert.equal(outOfScopeUpdate.status, 404);
  const traderShare = await api("/deliveries/requests", {
    token: traderToken,
    method: "POST",
    body: deliveryDetails(batch.batchId, "rejecting.workflow.transporter@workflow.test")
  });
  assert.equal(traderShare.status, 201);
  const traderRequested = await api(`/deliveries/requests/${traderShare.data.request.id}/respond`, {
    token: rejectingTransporterToken,
    method: "POST",
    body: { decision: "Accepted" }
  });
  assert.equal(traderRequested.status, 200);
  const cancelled = await api(`/deliveries/${traderRequested.data.delivery.id}/status`, {
    token: rejectingTransporterToken,
    method: "PATCH",
    body: { status: "Cancelled" }
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.delivery.status, "Cancelled");
  const farmerShareStatuses = await api("/deliveries/mine", { token: farmerToken });
  assert.equal(farmerShareStatuses.data.shares.find(item => item.id === traderShare.data.request.id).status, "Cancelled");

  const unauthorizedBatchChange = await api(`/batches/${batch.batchId}/publish`, {
    token: traderToken,
    method: "PATCH"
  });
  assert.equal(unauthorizedBatchChange.status, 403);

  const farmerBatchList = await api("/batches", { token: farmerToken });
  const farmerBatch = farmerBatchList.data.batches.find(item => item.batchId === batch.batchId);
  assert.equal(farmerBatch.estimatedNet, 8915);
  assert.equal(farmerBatch.status, "Sold");
  const farmerAlerts = await api("/alerts", { token: farmerToken });
  assert.ok(farmerAlerts.data.alerts.some(alert => alert.batchId === batch.batchId && alert.type === "dispatch-priority"));
  const farmerDeliveryRecords = await api("/deliveries/mine", { token: farmerToken });
  assert.ok(farmerDeliveryRecords.data.deliveries.some(item => item.batchId === batch.batchId && item.status === "Delivered"));
  assert.equal(farmerDeliveryRecords.data.shares.find(item => item.id === shared.data.request.id).status, "Delivered");

  const publicRecord = await api(`/batches/public/${batch.batchId}`);
  assert.equal(publicRecord.status, 200);
  const milestoneTypes = publicRecord.data.batch.milestones.map(item => item.type);
  assert.ok(milestoneTypes.includes("purchase-interest"));
  assert.ok(milestoneTypes.includes("storage-recorded"));
  assert.ok(milestoneTypes.includes("delivery-status"));
  assert.ok(milestoneTypes.includes("risk-estimate"));
  assert.ok(publicRecord.data.batch.milestones.some(item => item.type === "delivery-status" && item.label.includes("Cancelled")));
  assert.ok(publicRecord.data.batch.milestones.some(item =>
    item.type === "risk-estimate" &&
    item.riskLevel === "Medium" &&
    item.explanations.some(explanation => explanation.includes("14+ day age rule"))
  ));
  const publicText = JSON.stringify(publicRecord.data);
  for (const forbidden of ["farmerName", "transporterEmail", "requester", "transporter", "_id"]) {
    assert.equal(publicText.includes(`"${forbidden}"`), false);
  }
});

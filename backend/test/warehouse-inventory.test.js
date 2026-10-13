import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet;
let server;
let baseUrl;

before(async () => {
  process.env.JWT_SECRET = "warehouse-test-secret-with-at-least-32-chars";
  replSet = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 }
  });
  await mongoose.connect(replSet.getUri());

  const app = (await import("../src/app.js")).default;
  const { default: Batch } = await import("../src/models/Batch.js");
  const { default: StorageFacility } = await import("../src/models/StorageFacility.js");
  const { default: WarehouseInventory } = await import("../src/models/WarehouseInventory.js");
  await Promise.all([Batch.init(), StorageFacility.init(), WarehouseInventory.init()]);

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
      password: "warehouse-test-password",
      role
    }
  });
  assert.equal(result.status, 201);
  return result.data.token;
}

async function createAndPublishBatch(farmerToken) {
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

async function authorizeWarehouseStorage(farmerToken, batchId, authorized = true) {
  return api(`/batches/${batchId}/warehouse-authorization`, {
    token: farmerToken,
    method: "PATCH",
    body: { authorized }
  });
}

async function createFacility(token, capacityKg, supportedCropTypes = ["tomato"]) {
  return api("/warehouses/facilities", {
    token,
    method: "POST",
    body: {
      name: "Test cold store",
      location: "Test village",
      capacityKg,
      supportedCropTypes
    }
  });
}

test("warehouse facilities enforce role, ownership, capacity, crop, inventory and dispatch rules", async () => {
  const farmerToken = await signup("Warehouse Farmer", "farmer");
  const warehouseToken = await signup("Main Warehouse", "warehouse");
  const otherWarehouseToken = await signup("Other Warehouse", "warehouse");
  const traderToken = await signup("Warehouse Trader", "trader");
  const batchId = await createAndPublishBatch(farmerToken);

  const forbiddenFacilities = await api("/warehouses/facilities", { token: farmerToken });
  assert.equal(forbiddenFacilities.status, 403);

  const invalidFacility = await createFacility(warehouseToken, 1000, []);
  assert.equal(invalidFacility.status, 400);

  const facilityResult = await createFacility(warehouseToken, 100, ["Tomato"]);
  assert.equal(facilityResult.status, 201);
  const facilityId = facilityResult.data.facility.id;
  assert.equal(facilityResult.data.facility.availableCapacityKg, 100);

  const unauthorizedFacility = await api(`/warehouses/facilities/${facilityId}/inventory`, { token: otherWarehouseToken });
  assert.equal(unauthorizedFacility.status, 404);
  const forbiddenRoleFacility = await api(`/warehouses/facilities/${facilityId}/inventory`, { token: traderToken });
  assert.equal(forbiddenRoleFacility.status, 403);

  const invalidId = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId: "not-a-batch", quantityKg: 25, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(invalidId.status, 400);

  const zeroQuantity = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId: "FM-20000101-ABCDEF", quantityKg: 0, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(zeroQuantity.status, 400);

  const unknownBatch = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId: "FM-20000101-ABCDEF", quantityKg: 10, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(unknownBatch.status, 404);

  const unauthorizedIntake = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId, quantityKg: 80, storageType: "Cold", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(unauthorizedIntake.status, 404);
  const storageAuthorization = await authorizeWarehouseStorage(farmerToken, batchId);
  assert.equal(storageAuthorization.status, 200);
  assert.equal(storageAuthorization.data.batch.warehouseStorageAuthorized, true);

  const intake = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId, quantityKg: 80, storageType: "Cold", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(intake.status, 201);
  const inventoryId = intake.data.inventory.id;

  const invalidStorageType = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId: await createAndPublishBatch(farmerToken), quantityKg: 10, storageType: "Unsafe", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(invalidStorageType.status, 400);

  const duplicate = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId, quantityKg: 10, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(duplicate.status, 409);

  const unsupportedCropFacility = await createFacility(warehouseToken, 1000, ["rice"]);
  const unsupportedCrop = await api(`/warehouses/facilities/${unsupportedCropFacility.data.facility.id}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId, quantityKg: 10, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(unsupportedCrop.status, 400);

  const extraBatchId = await createAndPublishBatch(farmerToken);
  assert.equal((await authorizeWarehouseStorage(farmerToken, extraBatchId)).status, 200);
  const overCapacity = await api(`/warehouses/facilities/${facilityId}/inventory`, {
    token: warehouseToken,
    method: "POST",
    body: { batchId: extraBatchId, quantityKg: 30, storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(overCapacity.status, 409);

  const inventoryResponse = await api(`/warehouses/facilities/${facilityId}/inventory?search=tomato&status=Stored`, { token: warehouseToken });
  assert.equal(inventoryResponse.status, 200);
  assert.equal(inventoryResponse.data.inventory.length, 1);
  assert.equal(inventoryResponse.data.oldestStored[0].id, inventoryId);
  assert.equal(inventoryResponse.data.facility.usedCapacityKg, 80);
  assert.equal(inventoryResponse.data.facility.availableCapacityKg, 20);

  const unauthorizedStatus = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/status`, {
    token: otherWarehouseToken,
    method: "PATCH",
    body: { status: "Spoiled" }
  });
  assert.equal(unauthorizedStatus.status, 404);

  const invalidTransition = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/status`, {
    token: warehouseToken,
    method: "PATCH",
    body: { status: "Dispatched" }
  });
  assert.equal(invalidTransition.status, 409);

  const qualityCheck = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/status`, {
    token: warehouseToken,
    method: "PATCH",
    body: { status: "Quality Check" }
  });
  assert.equal(qualityCheck.status, 200);

  const oversizedDispatch = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/outgoing`, {
    token: warehouseToken,
    method: "POST",
    body: { quantityKg: 90 }
  });
  assert.equal(oversizedDispatch.status, 400);

  const partialDispatch = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/outgoing`, {
    token: warehouseToken,
    method: "POST",
    body: { quantityKg: 30 }
  });
  assert.equal(partialDispatch.status, 200);
  assert.equal(partialDispatch.data.inventory.status, "Partially Dispatched");
  assert.equal(partialDispatch.data.inventory.storedQuantityKg, 50);

  const facilityAfterPartialDispatch = await api(`/warehouses/facilities/${facilityId}/inventory`, { token: warehouseToken });
  assert.equal(facilityAfterPartialDispatch.data.facility.usedCapacityKg, 50);
  assert.equal(facilityAfterPartialDispatch.data.facility.availableCapacityKg, 50);

  const finalDispatch = await api(`/warehouses/facilities/${facilityId}/inventory/${inventoryId}/outgoing`, {
    token: warehouseToken,
    method: "POST",
    body: { quantityKg: 50 }
  });
  assert.equal(finalDispatch.status, 200);
  assert.equal(finalDispatch.data.inventory.status, "Dispatched");
  assert.equal(finalDispatch.data.inventory.storedQuantityKg, 0);
  const revokedAuthorization = await authorizeWarehouseStorage(farmerToken, batchId, false);
  assert.equal(revokedAuthorization.status, 200);
  assert.equal(revokedAuthorization.data.batch.warehouseStorageAuthorized, false);

  const facilityAfterFinalDispatch = await api(`/warehouses/facilities/${facilityId}/inventory`, { token: warehouseToken });
  assert.equal(facilityAfterFinalDispatch.data.facility.usedCapacityKg, 0);
  assert.equal(facilityAfterFinalDispatch.data.oldestStored.length, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicTraceability, isValidPublicTraceabilityId } from "../src/services/traceabilityService.js";

test("public traceability ID validation preserves existing batch ID format", () => {
  assert.equal(isValidPublicTraceabilityId("FM-20261011-A1B2C3"), true);
  assert.equal(isValidPublicTraceabilityId("FM-20260230-A1B2C3"), false);
  assert.equal(isValidPublicTraceabilityId("FM-20261011-12345Z"), false);
  assert.equal(isValidPublicTraceabilityId("FM-20261011-A1B2C3-extra"), false);
  assert.equal(isValidPublicTraceabilityId(null), false);
});

test("public projection handles missing fields and excludes private and internal fields", () => {
  const batch = buildPublicTraceability({
    batchId: "FM-20261011-A1B2C3",
    cropName: null,
    quantityKg: undefined,
    harvestDate: null,
    farmLocation: null,
    status: "Available",
    statusUpdatedAt: null,
    farmerName: "Private Farmer",
    farmer: "private-account-id",
    _id: "internal-database-id",
    createdAt: null
  });
  assert.equal(batch.traceabilityId, "FM-20261011-A1B2C3");
  assert.equal(batch.batchId, "FM-20261011-A1B2C3");
  assert.equal(batch.status, "Available");
  assert.equal(batch.originLocation, null);
  assert.equal(batch.quantityKg, null);
  assert.equal(batch.harvestDate, null);
  assert.deepEqual(batch.milestones, [{
    type: "batch-status",
    label: "Latest batch status recorded: Available",
    recordedAt: null
  }]);
  for (const field of ["farmerName", "farmer", "_id", "id", "email", "password", "token"]) {
    assert.equal(Object.hasOwn(batch, field), false);
  }
});

test("public timeline uses recorded storage and delivery facts and labels expected dates as estimates", () => {
  const assessedAt = new Date("2026-10-12T00:00:00.000Z");
  const batch = buildPublicTraceability({
    batchId: "FM-20261011-A1B2C3",
    cropName: "Tomato",
    quantityKg: 500,
    harvestDate: new Date("2026-10-01T00:00:00.000Z"),
    farmLocation: "Recorded village",
    status: "Available",
    statusUpdatedAt: new Date("2026-10-02T00:00:00.000Z"),
    createdAt: new Date("2026-10-01T00:00:00.000Z")
  }, [{
    storageType: "Cold",
    storageDate: new Date("2026-10-03T00:00:00.000Z"),
    status: "Stored",
    storedQuantityKg: 300,
    lastDispatchedAt: new Date("2026-10-04T00:00:00.000Z"),
    createdAt: new Date("2026-10-03T00:00:00.000Z"),
    updatedAt: new Date("2026-10-04T00:00:00.000Z")
  }], [{
    status: "In Transit",
    expectedDeliveryDate: new Date("2026-10-07T00:00:00.000Z"),
    statusUpdatedAt: new Date("2026-10-05T00:00:00.000Z")
  }], {
    purchaseInterests: [{
      status: "Accepted",
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
      updatedAt: new Date("2026-10-02T12:00:00.000Z")
    }],
    riskAssessment: {
      level: "Medium",
      explanations: ["Recorded storage duration triggered the 7-day rule."]
    },
    assessedAt
  });

  assert.equal(batch.cropName, "Tomato");
  assert.equal(batch.originLocation, "Recorded village");
  assert.equal(batch.quantityKg, 500);
  assert.equal(batch.latestStatus, "Available");
  assert.ok(batch.milestones.some(item => item.type === "storage-status" && item.storedQuantityKg === 300));
  assert.ok(batch.milestones.some(item => item.type === "storage-dispatch"));
  assert.ok(batch.milestones.some(item => item.type === "delivery-status" && item.expectedDeliveryDate === "2026-10-07T00:00:00.000Z"));
  assert.ok(batch.milestones.some(item => item.type === "purchase-interest" && item.decisionStatus === "Accepted"));
  assert.ok(batch.milestones.some(item => item.type === "risk-estimate" && item.isEstimate && item.riskLevel === "Medium"));
  assert.deepEqual(batch.milestones.find(item => item.type === "risk-estimate").explanations, [
    "Recorded storage duration triggered the 7-day rule."
  ]);
  assert.deepEqual(batch.milestones.map(item => item.recordedAt).filter(Boolean), [
    "2026-10-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
    "2026-10-02T00:00:00.000Z",
    "2026-10-02T12:00:00.000Z",
    "2026-10-03T00:00:00.000Z",
    "2026-10-04T00:00:00.000Z",
    "2026-10-04T00:00:00.000Z",
    "2026-10-05T00:00:00.000Z",
    "2026-10-12T00:00:00.000Z"
  ]);
});
test("public DTO preserves recorded public fields without private account data", () => {
  const dto = buildPublicTraceability({
    batchId: "FM-20261011-A1B2C3",
    cropName: "Rice",
    marketVariety: "Common",
    farmLocation: "Recorded farm village",
    quantityKg: 100,
    harvestDate: "2026-10-01",
    createdAt: "2026-09-30T10:00:00.000Z",
    status: "Available",
    statusUpdatedAt: "2026-10-02T10:00:00.000Z"
  }, [], [{ status: "Delivered", destination: "Market yard", quantityKg: 75, statusUpdatedAt: "2026-10-04T10:00:00.000Z" }]);
  assert.equal(dto.variety, "Common");
  assert.equal(dto.registrationDate, "2026-09-30T10:00:00.000Z");
  assert.equal(dto.quantityUnit, "kg");
  assert.equal(dto.milestones.find(item => item.type === "delivery-status").destination, "Market yard");
  assert.equal(Object.hasOwn(dto, "farmerName"), false);
});

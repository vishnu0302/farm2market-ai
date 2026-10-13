import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBatchSpoilageRisk, buildBatchRiskAlerts } from "../src/services/spoilageRiskService.js";

const DAY_MS = 86400000;
const now = new Date("2026-10-11T12:00:00.000Z");
const dateDaysAgo = days => new Date(now.getTime() - days * DAY_MS);

test("fresh harvest with no recorded storage or delayed deliveries is Low", () => {
  const result = assessBatchSpoilageRisk({ harvestDate: dateDaysAgo(2), now });
  assert.equal(result.level, "Low");
  assert.equal(result.daysSinceHarvest, 2);
  assert.equal(result.daysInStorage, null);
  assert.match(result.explanations[0], /No elevated-risk rules/);
});

test("age and storage rules switch at the documented 7-day and 14-day boundaries", () => {
  const ageAtSeven = assessBatchSpoilageRisk({ harvestDate: dateDaysAgo(7), now });
  assert.equal(ageAtSeven.level, "Low");
  assert.match(ageAtSeven.explanations.join(" "), /7–13 day age rule/);

  const ageAtFourteen = assessBatchSpoilageRisk({ harvestDate: dateDaysAgo(14), now });
  assert.equal(ageAtFourteen.level, "Medium");
  assert.match(ageAtFourteen.explanations.join(" "), /14\+ day age rule/);

  const storageAtSeven = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    inventoryRecords: [{
      storageDate: dateDaysAgo(7),
      storageType: "Cold",
      status: "Stored",
      storedQuantityKg: 25
    }],
    now
  });
  assert.equal(storageAtSeven.level, "Low");
  assert.match(storageAtSeven.explanations.join(" "), /7–13 day storage rule/);

  const storageAtFourteen = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    inventoryRecords: [{
      storageDate: dateDaysAgo(14),
      storageType: "Cold",
      status: "Stored",
      storedQuantityKg: 25
    }],
    now
  });
  assert.equal(storageAtFourteen.level, "Medium");
  assert.match(storageAtFourteen.explanations.join(" "), /14\+ day storage rule/);
});

test("recorded harvest age, storage duration, and ambient storage affect rating with explanations", () => {
  const result = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(8),
    inventoryRecords: [{
      storageDate: dateDaysAgo(8),
      storageType: "Ambient",
      status: "Stored",
      storedQuantityKg: 100
    }],
    now
  });
  assert.equal(result.level, "Medium");
  assert.equal(result.daysInStorage, 8);
  assert.equal(result.explanations.length, 3);
  assert.match(result.explanations.join(" "), /Ambient storage/);
});

test("old harvest and long cold storage trigger High without claiming certainty", () => {
  const result = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(20),
    inventoryRecords: [{
      storageDate: dateDaysAgo(15),
      storageType: "Cold",
      status: "Stored",
      storedQuantityKg: 100
    }],
    now
  });
  assert.equal(result.level, "High");
  assert.match(result.explanations.join(" "), /14\+ day age rule/);
  assert.match(result.explanations.join(" "), /14\+ day storage rule/);
});

test("overdue active and late completed deliveries are detected from recorded dates", () => {
  const overdue = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    deliveries: [{ status: "In Transit", expectedDeliveryDate: dateDaysAgo(2) }],
    now
  });
  assert.equal(overdue.level, "Medium");
  assert.equal(overdue.delayedDeliveries[0].daysLate, 2);

  const completedLate = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    deliveries: [{
      status: "Delivered",
      expectedDeliveryDate: dateDaysAgo(4),
      statusUpdatedAt: dateDaysAgo(2)
    }],
    now
  });
  assert.equal(completedLate.delayedDeliveries.length, 1);
  assert.equal(completedLate.delayedDeliveries[0].daysLate, 2);
});

test("missing or invalid required inputs return Insufficient data rather than a risk score", () => {
  const missingHarvest = assessBatchSpoilageRisk({ inventoryRecords: [], now });
  assert.equal(missingHarvest.level, "Insufficient data");
  assert.ok(missingHarvest.explanations[0].includes("harvest date"));

  const missingStorageDate = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    inventoryRecords: [{ storageType: "Ambient", status: "Stored", storedQuantityKg: 100 }],
    now
  });
  assert.equal(missingStorageDate.level, "Insufficient data");
  assert.equal(missingStorageDate.daysInStorage, null);
  const nullDeliveryDate = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(1),
    deliveries: [{ status: "In Transit", expectedDeliveryDate: null }],
    now
  });
  assert.equal(nullDeliveryDate.level, "Insufficient data");

  const futureHarvest = assessBatchSpoilageRisk({ harvestDate: new Date(now.getTime() + DAY_MS), now });
  assert.equal(futureHarvest.level, "Insufficient data");
  const nullHarvest = assessBatchSpoilageRisk({ harvestDate: null, now });
  assert.equal(nullHarvest.level, "Insufficient data");

  const inaccessibleStorage = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(20),
    storageContextAvailable: false,
    now
  });
  assert.equal(inaccessibleStorage.level, "Insufficient data");
  assert.match(inaccessibleStorage.explanations[0], /current permissions/);
});

test("priority alerts use stable fingerprints and delayed alerts remain available with incomplete risk inputs", () => {
  const batch = { batchId: "FM-20261001-A1B2C3", cropName: "Tomato" };
  const inventoryRecords = [{
    storageDate: dateDaysAgo(8),
    storageType: "Ambient",
    status: "Stored",
    storedQuantityKg: 100
  }];
  const firstRisk = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(8),
    inventoryRecords,
    now
  });
  const laterNow = new Date(now.getTime() + DAY_MS);
  const laterRisk = assessBatchSpoilageRisk({
    harvestDate: dateDaysAgo(8),
    inventoryRecords,
    now: laterNow
  });
  const firstKey = buildBatchRiskAlerts(batch, firstRisk, inventoryRecords, now)
    .find(alert => alert.type === "spoilage-risk").key;
  const laterKey = buildBatchRiskAlerts(batch, laterRisk, inventoryRecords, laterNow)
    .find(alert => alert.type === "spoilage-risk").key;
  assert.equal(firstKey, laterKey);

  const lateDelivery = { status: "In Transit", expectedDeliveryDate: dateDaysAgo(2) };
  const insufficient = assessBatchSpoilageRisk({
    deliveries: [lateDelivery],
    now
  });
  const alerts = buildBatchRiskAlerts(batch, insufficient, [], now);
  assert.equal(insufficient.level, "Insufficient data");
  assert.ok(alerts.some(alert => alert.type === "delayed-delivery"));
});

import { createHash } from "node:crypto";

const DAY_MS = 86400000;
const ACTIVE_STORAGE_STATUSES = new Set(["Stored", "Quality Check", "Partially Dispatched"]);
const ACTIVE_DELIVERY_STATUSES = new Set(["Accepted", "In Transit"]);

function dayDifference(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fingerprint(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function findDelayedDeliveries(deliveries, now) {
  return deliveries.filter(delivery =>
    ACTIVE_DELIVERY_STATUSES.has(delivery.status) || delivery.status === "Delivered"
  ).filter(delivery => {
    const expected = validDate(delivery.expectedDeliveryDate);
    if (!expected) return false;
    if (delivery.status === "Delivered") {
      const actual = validDate(delivery.statusUpdatedAt);
      return Boolean(actual && actual > expected);
    }
    return expected < now;
  }).map(delivery => {
    const expected = validDate(delivery.expectedDeliveryDate);
    const actualOrCurrent = delivery.status === "Delivered" ? validDate(delivery.statusUpdatedAt) : now;
    return {
      delivery,
      daysLate: Math.max(1, dayDifference(expected, actualOrCurrent))
    };
  });
}

export function assessBatchSpoilageRisk({
  harvestDate,
  inventoryRecords = [],
  deliveries = [],
  storageContextAvailable = true,
  now = new Date()
}) {
  const currentDate = validDate(now);
  const delayedDeliveries = currentDate ? findDelayedDeliveries(deliveries, currentDate) : [];
  const harvestedAt = validDate(harvestDate);
  if (!currentDate || !harvestedAt || harvestedAt > currentDate) {
    return {
      level: "Insufficient data",
      explanations: ["A valid harvest date on or before today is needed to estimate risk."],
      daysSinceHarvest: null,
      daysInStorage: null,
      delayedDeliveries
    };
  }

  const storage = inventoryRecords.filter(item =>
    Number(item.storedQuantityKg) > 0 && ACTIVE_STORAGE_STATUSES.has(item.status)
  );
  const storageAges = storage.map(item => {
    const storedAt = validDate(item.storageDate);
    return { item, storedAt, days: storedAt ? dayDifference(storedAt, currentDate) : null };
  });
  const invalidStorageData = storageAges.some(({ item, storedAt, days }) =>
    !storedAt || storedAt > currentDate || days === null || typeof item.storageType !== "string" || !item.storageType
  );
  if (invalidStorageData) {
    return {
      level: "Insufficient data",
      explanations: ["A valid storage date and storage type are needed for the recorded stored quantity."],
      daysSinceHarvest: dayDifference(harvestedAt, currentDate),
      daysInStorage: null,
      delayedDeliveries
    };
  }

  const daysSinceHarvest = dayDifference(harvestedAt, currentDate);
  if (!storageContextAvailable) {
    return {
      level: "Insufficient data",
      explanations: ["Storage details are not available within this account's current permissions, so a complete risk rating cannot be calculated."],
      daysSinceHarvest,
      daysInStorage: null,
      delayedDeliveries
    };
  }
  const daysInStorage = storageAges.length ? Math.max(...storageAges.map(entry => entry.days)) : null;
  const activeDeliveries = deliveries.filter(delivery =>
    ACTIVE_DELIVERY_STATUSES.has(delivery.status) || delivery.status === "Delivered"
  );
  const invalidDeliveryDate = activeDeliveries.some(delivery =>
    !validDate(delivery.expectedDeliveryDate) ||
    (delivery.status === "Delivered" && !validDate(delivery.statusUpdatedAt))
  );
  if (invalidDeliveryDate) {
    return {
      level: "Insufficient data",
      explanations: ["A valid expected delivery date and recorded delivery status date are needed."],
      daysSinceHarvest,
      daysInStorage,
      delayedDeliveries
    };
  }

  let points = 0;
  const explanations = [];
  if (daysSinceHarvest >= 14) {
    points += 2;
    explanations.push(`Harvest was recorded ${daysSinceHarvest} days ago (14+ day age rule).`);
  } else if (daysSinceHarvest >= 7) {
    points += 1;
    explanations.push(`Harvest was recorded ${daysSinceHarvest} days ago (7–13 day age rule).`);
  }

  if (daysInStorage !== null && daysInStorage >= 14) {
    points += 2;
    explanations.push(`Stored quantity has remained in storage for at least ${daysInStorage} days (14+ day storage rule).`);
  } else if (daysInStorage !== null && daysInStorage >= 7) {
    points += 1;
    explanations.push(`Stored quantity has remained in storage for ${daysInStorage} days (7–13 day storage rule).`);
  }

  const ambientStorageDays = storageAges
    .filter(({ item, days }) => item.storageType === "Ambient" && days >= 7)
    .reduce((maximum, entry) => Math.max(maximum, entry.days), 0);
  if (ambientStorageDays > 0) {
    points += 1;
    explanations.push(`Ambient storage is recorded for at least ${ambientStorageDays} days (additional 7+ day ambient rule).`);
  }

  if (delayedDeliveries.length > 0) {
    points += 2;
    const maxDaysLate = Math.max(...delayedDeliveries.map(item => item.daysLate));
    explanations.push(`${delayedDeliveries.length} delivery record${delayedDeliveries.length === 1 ? " is" : "s are"} past the expected delivery date (up to ${maxDaysLate} day${maxDaysLate === 1 ? "" : "s"} late).`);
  }

  if (explanations.length === 0) {
    explanations.push("No elevated-risk rules were triggered by the recorded harvest, storage, or delivery information.");
  }
  return {
    level: points >= 4 ? "High" : points >= 2 ? "Medium" : "Low",
    explanations,
    daysSinceHarvest,
    daysInStorage,
    delayedDeliveries
  };
}

export function buildBatchRiskAlerts(batch, assessment, inventoryRecords = [], now = new Date()) {
  const alerts = [];
  const storage = inventoryRecords.filter(item =>
    Number(item.storedQuantityKg) > 0 && ACTIVE_STORAGE_STATUSES.has(item.status)
  );
  const storageAges = storage.map(item => {
    const storedAt = validDate(item.storageDate);
    return storedAt ? { item, days: dayDifference(storedAt, validDate(now)) } : null;
  }).filter(Boolean);
  const maxStorageAge = storageAges.length ? Math.max(...storageAges.map(entry => entry.days)) : null;
  const storageFingerprint = storageAges.map(({ item }) => [
    item.storageDate instanceof Date ? item.storageDate.toISOString() : item.storageDate,
    item.storageType,
    item.status,
    item.storedQuantityKg
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const addAlert = (type, title, level, explanation, context) => {
    const key = fingerprint([batch.batchId, type, context]);
    alerts.push({ key, batchId: batch.batchId, cropName: batch.cropName, type, title, level, explanation });
  };

  if (assessment.level === "High" || assessment.level === "Medium") {
    const ageBand = assessment.daysSinceHarvest >= 14 ? "14+" : assessment.daysSinceHarvest >= 7 ? "7-13" : "0-6";
    const storageBand = maxStorageAge === null ? null : maxStorageAge >= 14 ? "14+" : maxStorageAge >= 7 ? "7-13" : "0-6";
    const ambientRule = storageAges.some(({ item, days }) => item.storageType === "Ambient" && days >= 7);
    addAlert(
      "spoilage-risk",
      `${assessment.level} rule-based risk`,
      assessment.level,
      assessment.explanations.join(" "),
      [assessment.level, ageBand, storageBand, ambientRule, assessment.delayedDeliveries.map(({ delivery }) => [
        delivery.status,
        validDate(delivery.expectedDeliveryDate)?.toISOString(),
        delivery.statusUpdatedAt ? validDate(delivery.statusUpdatedAt)?.toISOString() : null
      ])]
    );
  }
  if (assessment.daysSinceHarvest >= 14 || (maxStorageAge !== null && maxStorageAge >= 7)) {
    addAlert(
      "dispatch-priority",
      "Consider earlier dispatch",
      maxStorageAge !== null && maxStorageAge >= 14 ? "High" : "Medium",
      "Recorded harvest age or storage duration has crossed a dispatch-priority rule. Consider checking this batch and arranging dispatch sooner.",
      [assessment.daysSinceHarvest >= 14, maxStorageAge === null ? null : maxStorageAge >= 14 ? "14+" : "7+", storageFingerprint]
    );
  }
  if (maxStorageAge !== null && maxStorageAge >= 14) {
    addAlert(
      "long-storage",
      "Long storage duration",
      "High",
      `A remaining quantity has been recorded in storage for at least ${maxStorageAge} days.`,
      ["14+", storageFingerprint]
    );
  }
  if (assessment.delayedDeliveries.length > 0) {
    const delays = assessment.delayedDeliveries.map(({ delivery }) => ({
      status: delivery.status,
      expectedDeliveryDate: validDate(delivery.expectedDeliveryDate).toISOString(),
      statusUpdatedAt: delivery.statusUpdatedAt ? validDate(delivery.statusUpdatedAt)?.toISOString() : null
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    addAlert(
      "delayed-delivery",
      "Delivery is past its expected date",
      "High",
      `${delays.length} active or completed delivery record${delays.length === 1 ? " is" : "s are"} past the manually entered expected delivery date. Check the recorded status with the transporter.`,
      delays
    );
  }
  return alerts;
}

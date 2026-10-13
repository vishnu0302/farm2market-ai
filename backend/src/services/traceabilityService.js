import { isValidBatchId } from "../utils/batchId.js";

export function isValidPublicTraceabilityId(value) {
  return isValidBatchId(value);
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value) {
  return validDate(value)?.toISOString() || null;
}

function milestone(type, label, recordedAt, details = {}) {
  return { type, label, recordedAt: isoDate(recordedAt), ...details };
}

export function buildPublicTraceability(batch, inventoryRecords = [], deliveries = [], {
  purchaseInterests = [],
  riskAssessment = null,
  assessedAt = new Date()
} = {}) {
  const milestones = [];
  if (batch.createdAt) {
    milestones.push(milestone("batch-recorded", "Batch record created", batch.createdAt));
  }
  if (batch.status) {
    milestones.push(milestone(
      "batch-status",
      `Latest batch status recorded: ${batch.status}`,
      batch.statusUpdatedAt
    ));
  }
  if (batch.harvestDate) {
    milestones.push(milestone("harvest-recorded", "Harvest date recorded", batch.harvestDate));
  }

  for (const inventory of inventoryRecords) {
    if (inventory.storageDate) {
      milestones.push(milestone(
        "storage-recorded",
        "Storage intake recorded",
        inventory.createdAt || inventory.storageDate,
        {
          storageType: inventory.storageType || null,
          storageDate: isoDate(inventory.storageDate)
        }
      ));
    }
    if (inventory.status) {
      milestones.push(milestone(
        "storage-status",
        `Latest warehouse record: ${inventory.status}`,
        inventory.updatedAt || inventory.storageDate,
        {
          storageType: inventory.storageType || null,
          storedQuantityKg: Number.isFinite(inventory.storedQuantityKg) ? inventory.storedQuantityKg : null
        }
      ));
    }
    if (inventory.lastDispatchedAt) {
      milestones.push(milestone("storage-dispatch", "Outgoing quantity recorded from storage", inventory.lastDispatchedAt));
    }
  }

  for (const delivery of deliveries) {
    if (delivery.status) {
      milestones.push(milestone(
        "delivery-status",
        `Delivery status recorded: ${delivery.status}`,
        delivery.statusUpdatedAt || delivery.updatedAt,
        {
          expectedDeliveryDate: isoDate(delivery.expectedDeliveryDate),
          destination: delivery.destination || null,
          quantityKg: Number.isFinite(delivery.quantityKg) ? delivery.quantityKg : null
        }
      ));
    }
  }

  for (const interest of purchaseInterests) {
    if (interest.status) {
      milestones.push(milestone(
        "purchase-interest",
        `Purchase interest status recorded: ${interest.status}`,
        interest.updatedAt || interest.createdAt,
        { decisionStatus: interest.status }
      ));
    }
  }

  if (riskAssessment) {
    milestones.push(milestone(
      "risk-estimate",
      `Current rule-based risk estimate: ${riskAssessment.level}`,
      assessedAt,
      {
        isEstimate: true,
        riskLevel: riskAssessment.level,
        explanations: riskAssessment.explanations
      }
    ));
  }

  milestones.sort((first, second) => {
    if (!first.recordedAt) return second.recordedAt ? 1 : first.label.localeCompare(second.label);
    if (!second.recordedAt) return -1;
    return first.recordedAt.localeCompare(second.recordedAt);
  });

  return {
    traceabilityId: batch.batchId || null,
    batchId: batch.batchId || null,
    cropName: batch.cropName || null,
    variety: batch.variety || batch.marketVariety || null,
    originLocation: batch.farmLocation || null,
    quantityKg: Number.isFinite(batch.quantityKg) ? batch.quantityKg : null,
    quantityUnit: Number.isFinite(batch.quantityKg) ? "kg" : null,
    registrationDate: isoDate(batch.createdAt),
    harvestDate: isoDate(batch.harvestDate),
    latestStatus: batch.status || null,
    status: batch.status || null,
    latestStatusRecordedAt: isoDate(batch.statusUpdatedAt),
    milestones
  };
}

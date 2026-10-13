const MAX_QUANTITY_KG = 100000000;
const MAX_PRICE_PER_KG = 1000000000;
const MAX_COST = 1000000000;

export class MarketCalculationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketCalculationError";
  }
}

function validateAmount(value, label, { min = 0, max = MAX_COST } = {}) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    !["number", "string"].includes(typeof value)
  ) {
    throw new MarketCalculationError(`${label} is required.`);
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    throw new MarketCalculationError(`${label} must be between ${min} and ${max}.`);
  }
  return amount;
}

function roundCurrency(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateMarketReturn({
  quantityKg,
  pricePerKg,
  transportCost,
  handlingCost,
  otherCosts
}) {
  const quantity = validateAmount(quantityKg, "Quantity (kg)", { min: 0.01, max: MAX_QUANTITY_KG });
  const price = validateAmount(pricePerKg, "Price per kg", { min: 0.01, max: MAX_PRICE_PER_KG });
  const transport = validateAmount(transportCost, "Transport cost");
  const handling = validateAmount(handlingCost, "Handling/storage cost");
  const other = validateAmount(otherCosts, "Other costs");
  const gross = roundCurrency(quantity * price);
  const net = roundCurrency(gross - transport - handling - other);

  return {
    quantityKg: quantity,
    pricePerKg: price,
    estimatedGross: gross,
    transportCost: transport,
    handlingCost: handling,
    otherCosts: other,
    estimatedNet: net
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketReturn, MarketCalculationError } from "../src/services/marketComparisonService.js";

test("calculates gross revenue and estimated net return from explicit cost inputs", () => {
  assert.deepEqual(calculateMarketReturn({
    quantityKg: 125.5,
    pricePerKg: 28.4,
    transportCost: 120,
    handlingCost: 35.5,
    otherCosts: 10
  }), {
    quantityKg: 125.5,
    pricePerKg: 28.4,
    estimatedGross: 3564.2,
    transportCost: 120,
    handlingCost: 35.5,
    otherCosts: 10,
    estimatedNet: 3398.7
  });
});

test("allows an explicitly entered zero cost and a negative estimated net", () => {
  const result = calculateMarketReturn({
    quantityKg: 1,
    pricePerKg: 10,
    transportCost: 0,
    handlingCost: 0,
    otherCosts: 25
  });

  assert.equal(result.estimatedGross, 10);
  assert.equal(result.estimatedNet, -15);
});

test("rejects missing, negative, non-finite, and out-of-range calculation inputs", () => {
  const validInputs = {
    quantityKg: 100,
    pricePerKg: 20,
    transportCost: 10,
    handlingCost: 5,
    otherCosts: 0
  };

  for (const invalid of [
    { ...validInputs, quantityKg: "" },
    { ...validInputs, quantityKg: -1 },
    { ...validInputs, quantityKg: 100000001 },
    { ...validInputs, transportCost: [] },
    { ...validInputs, pricePerKg: Number.NaN },
    { ...validInputs, pricePerKg: 0 },
    { ...validInputs, transportCost: undefined },
    { ...validInputs, handlingCost: -1 },
    { ...validInputs, otherCosts: 1000000001 }
  ]) {
    assert.throws(() => calculateMarketReturn(invalid), MarketCalculationError);
  }
});

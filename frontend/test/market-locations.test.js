import assert from "node:assert/strict";
import test from "node:test";
import {
  getMandiDistrictOptions,
  getMandiMarketOptions,
  isMandiOptionSelected,
  updateMandiLocationFilters
} from "../src/marketLocations.js";

const locations = [
  { state: "State A", district: "District 1", market: "Market X" },
  { state: "State A", district: "District 1", market: "Market Y" },
  { state: "State A", district: "District 2", market: "Market Z" },
  { state: "State B", district: "District 1", market: "Market Q" }
];

test("dependent location options derive from actual loaded records", () => {
  assert.deepEqual(getMandiDistrictOptions(locations, "State A"), ["District 1", "District 2"]);
  assert.deepEqual(getMandiMarketOptions(locations, "State A", "District 1"), ["Market X", "Market Y"]);
  assert.deepEqual(getMandiMarketOptions(locations, "State B", "District 1"), ["Market Q"]);
  assert.deepEqual(getMandiDistrictOptions(locations, " State   A "), ["District 1", "District 2"]);
  assert.deepEqual(getMandiMarketOptions(locations, "State A", " District   1 "), ["Market X", "Market Y"]);
  assert.deepEqual(getMandiDistrictOptions(locations, ""), []);
  assert.deepEqual(getMandiMarketOptions(locations, "State A", ""), []);
  assert.deepEqual(getMandiDistrictOptions(locations, "state a"), []);
  assert.deepEqual(getMandiMarketOptions(locations, "State A", "district 1"), []);
  assert.equal(isMandiOptionSelected(["State A", "State B"], " State A "), true);
  assert.equal(isMandiOptionSelected(["State A", "State B"], "state a"), false);
  assert.equal(isMandiOptionSelected(["State A", "State B"], "State   A"), true);
  assert.equal(isMandiOptionSelected(["State A", "State B"], "State C"), false);
});

test("changing a parent location clears its dependent selections", () => {
  const initial = { state: "State A", district: "District 1", market: "Market X", variety: "Hybrid" };
  assert.deepEqual(updateMandiLocationFilters(initial, "state", "State B"), {
    state: "State B", district: "", market: "", variety: "Hybrid"
  });
  assert.deepEqual(updateMandiLocationFilters(initial, "district", "District 2"), {
    state: "State A", district: "District 2", market: "", variety: "Hybrid"
  });
});

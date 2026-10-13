import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("price-unavailable state has one translated alert and one retry action", () => {
  assert.match(appSource, /marketError && <div[^>]+role="alert"/);
  assert.match(appSource, /messageText\(marketError\)/);
  assert.match(appSource, /tx\("mandiRetry"\)/);
  assert.doesNotMatch(appSource, /marketError &&[\s\S]{0,500}mandiCheckStatus/);
});

test("mandi requests use an exact commodity selected from the API catalog, not the batch crop label", () => {
  assert.match(appSource, /commodity: marketFilters\.commodity/);
  assert.match(appSource, /marketLocations\.commodities\.map\(commodity/);
  assert.match(appSource, /mandiFilterCommodity/);
});

test("official price cards show source grade and units, and empty results can clear optional filters", () => {
  assert.match(appSource, /market\.grade/);
  assert.match(appSource, /market\.reportedMinPrice/);
  assert.match(appSource, /market\.reportedMaxPrice/);
  assert.match(appSource, /market\.reportedModalPrice/);
  assert.match(appSource, /market\.priceUnit/);
  assert.match(appSource, /function clearOptionalMarketFilters/);
  assert.match(appSource, /mandiClearOptionalFilters/);
});

test("price-dependent selection stays disabled without a verified unit", () => {
  assert.match(appSource, /disabled=\{!market\.priceUnitVerified\}/);
  assert.match(appSource, /const selectedMarket = marketOptions\[selectedIndex\]\?\.priceUnitVerified/);
  assert.match(appSource, /batchCreatedWithoutMarketPrice/);
});

test("customer QR URLs use the configured public trace route", () => {
  assert.match(appSource, /VITE_PUBLIC_FRONTEND_URL/);
  assert.match(appSource, /publicFrontendUrl\}\/trace\//);
  assert.match(appSource, /(?:trace\|batches)/);
});

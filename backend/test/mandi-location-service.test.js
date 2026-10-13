import assert from "node:assert/strict";
import test from "node:test";
import { MandiPriceError } from "../src/services/mandiPriceService.js";
import { clearMandiLocationCache, getMandiLocationSnapshot } from "../src/services/mandiLocationService.js";

process.env.DATA_GOV_IN_API_KEY = "test-key";

function response(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => payload
  };
}

test("paginates the official resource and deduplicates whitespace-normalized locations", async () => {
  clearMandiLocationCache();
  const requests = [];
  const fetchImpl = async url => {
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset"));
    requests.push(offset);
    const records = offset === 0
      ? [
        { state: "State B", district: "District 2", market: "Market Z", commodity: "Wheat" },
        { state: "State A", district: "District 1", market: "Market X", commodity: "Wheat" }
      ]
      : [
        { state: " State   A ", district: "District 1", market: " Market X ", commodity: "Rice" },
        { state: "State A", district: "District 3", market: "Market Y", commodity: "Rice" }
      ];
    return response({ total: 4, offset: String(offset), limit: "2", records });
  };
  const snapshot = await getMandiLocationSnapshot({ fetchImpl, pageSize: 2, now: Date.parse("2026-10-13T00:00:00Z") });
  assert.deepEqual(requests, [0, 2]);
  assert.deepEqual(snapshot.states, ["State A", "State B"]);
  assert.deepEqual(snapshot.locations, [
    { state: "State A", district: "District 1", market: "Market X" },
    { state: "State A", district: "District 3", market: "Market Y" },
    { state: "State B", district: "District 2", market: "Market Z" }
  ]);
  assert.deepEqual(snapshot.commodities, ["Rice", "Wheat"]);
  assert.equal(snapshot.source, "data.gov.in");
});

test("uses complete state partitions when the provider result window is exceeded", async () => {
  clearMandiLocationCache();
  const requests = [];
  const globalRecords = [
    { state: "State A", district: "District 1", market: "Market A1", commodity: "Wheat" },
    { state: "State B", district: "District 2", market: "Market B1", commodity: "Rice" },
    { state: "State A", district: "District 4", market: "Market A2", commodity: "Maize" }
  ];
  const stateRecords = {
    "State A": globalRecords.filter(record => record.state === "State A"),
    "State B": [
      globalRecords[1],
      globalRecords[0]
    ]
  };
  const fetchImpl = async url => {
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset"));
    const state = parsed.searchParams.get("filters[state]");
    requests.push({ offset, state });
    const records = state ? stateRecords[state].slice(offset, offset + Number(parsed.searchParams.get("limit"))) : globalRecords.slice(offset, offset + Number(parsed.searchParams.get("limit")));
    return response({ total: state ? stateRecords[state].length : globalRecords.length, offset: String(offset), records });
  };

  const snapshot = await getMandiLocationSnapshot({ fetchImpl, pageSize: 2, resultWindow: 2, now: 3000 });
  assert.deepEqual(snapshot.locations, [
    { state: "State A", district: "District 1", market: "Market A1" },
    { state: "State A", district: "District 4", market: "Market A2" },
    { state: "State B", district: "District 2", market: "Market B1" }
  ]);
  assert.deepEqual(snapshot.commodities, ["Maize", "Rice", "Wheat"]);
  assert.deepEqual(requests[0], { offset: 0, state: null });
  assert.ok(requests.some(request => request.state === "State A"));
  assert.ok(requests.some(request => request.state === "State B"));
});

test("rejects an unpartitionable result instead of caching an incomplete location catalog", async () => {
  clearMandiLocationCache();
  const fetchImpl = async url => {
    const parsed = new URL(url);
    const state = parsed.searchParams.get("filters[state]");
    const offset = Number(parsed.searchParams.get("offset"));
    const limit = Number(parsed.searchParams.get("limit"));
    const records = state
      ? [{ state, district: "District 1", market: "Market X" }]
      : [
        { state: "State A", district: "District 1", market: "Market X" },
        { state: "State B", district: "District 1", market: "Market X" },
        { state: "State C", district: "District 1", market: "Market X" }
      ].slice(offset, offset + limit);
    return response({ total: state ? 1 : 3, offset: parsed.searchParams.get("offset"), records });
  };

  await assert.rejects(
    getMandiLocationSnapshot({ fetchImpl, pageSize: 2, resultWindow: 2, now: 4500 }),
    error => error instanceof MandiPriceError &&
      error.code === "MARKET_API_INCOMPLETE_LOCATION_DATA"
  );
});

test("retries rate-limited pages and caches only the successful catalog", async () => {
  clearMandiLocationCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? response({}, 429, { "retry-after": "0" })
      : response({ total: 1, offset: "0", records: [{ state: "State A", district: "District 1", market: "Market X", commodity: "Wheat" }] });
  };

  const snapshot = await getMandiLocationSnapshot({ fetchImpl, now: 6000 });
  assert.equal(calls, 2);
  assert.deepEqual(snapshot.commodities, ["Wheat"]);
});

test("caches the complete location catalog for concurrent and later callers", async () => {
  clearMandiLocationCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return response({
      total: 1,
      offset: "0",
      records: [{ state: "State A", district: "District 1", market: "Market X", commodity: "Wheat" }]
    });
  };

  const [first, second] = await Promise.all([
    getMandiLocationSnapshot({ fetchImpl, now: 4000 }),
    getMandiLocationSnapshot({ fetchImpl, now: 4000 })
  ]);
  const cached = await getMandiLocationSnapshot({ fetchImpl, now: 5000 });
  assert.equal(calls, 1);
  assert.deepEqual(first.locations, second.locations);
  assert.equal(cached.cacheStatus, "HIT");
});

test("rejects empty pages before the reported total is retrieved", async () => {
  clearMandiLocationCache();
  const fetchImpl = async url => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return offset === 0
      ? response({ total: 3, offset: "0", records: [
        { state: "State A", district: "District 1", market: "Market X" },
        { state: "State A", district: "District 1", market: "Market Y" }
      ] })
      : response({ total: 3, offset: "2", records: [] });
  };
  await assert.rejects(
    getMandiLocationSnapshot({ fetchImpl, pageSize: 2, now: 7000 }),
    error => error instanceof MandiPriceError &&
      error.code === "MARKET_API_INCOMPLETE_LOCATION_DATA"
  );
});

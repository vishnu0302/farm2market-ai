import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMandiPriceCache,
  diagnoseMandiApi,
  fetchMandiPrices,
  isValidReportDate,
  mapMandiRecord,
  MandiPriceError,
  validateMandiFilters,
  validatePagination
} from "../src/services/mandiPriceService.js";

process.env.DATA_GOV_IN_API_KEY = "test-key";
const rice = {
  arrival_date: "11/10/2026",
  state: "Andhra Pradesh",
  district: "Kurnool",
  market: "Kurnool",
  commodity: "Rice",
  variety: "Common",
  grade: "FAQ",
  min_price: "2,000",
  max_price: "2,400",
  modal_price: "2,200"
};

function response(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => payload
  };
}

test("maps official data.gov.in fields and preserves INR per-quintal values", () => {
  const record = mapMandiRecord(rice, new Date("2026-10-12T10:00:00Z"));
  assert.equal(record.commodity, "Rice");
  assert.equal(record.variety, "Common");
  assert.equal(record.grade, "FAQ");
  assert.equal(record.reportedMinPrice, 2000);
  assert.equal(record.reportedMaxPrice, 2400);
  assert.equal(record.reportedModalPrice, 2200);
  assert.equal(record.priceUnit, "₹/quintal");
  assert.equal(record.sourceUnit, "INR_PER_QUINTAL");
  assert.equal(record.modalPricePerKg, 22);
  assert.equal(record.dataSource, "data.gov.in");
});

test("rejects incomplete records and invalid dates", () => {
  assert.equal(mapMandiRecord({ ...rice, modal_price: "" }), null);
  assert.equal(mapMandiRecord({ ...rice, arrival_date: "31/02/2026" }), null);
  assert.equal(isValidReportDate("2024-02-29"), true);
  assert.equal(isValidReportDate("2025-02-29"), false);
});

test("validates pagination within the provider's 10,000-record result window", () => {
  assert.throws(() => validateMandiFilters({}), MandiPriceError);
  assert.deepEqual(validatePagination({ limit: "20", offset: "50" }), { limit: 20, offset: 50 });
  assert.deepEqual(validatePagination({ limit: "50", offset: "9950" }), { limit: 50, offset: 9950 });
  assert.throws(() => validatePagination({ limit: "50", offset: "9951" }), MandiPriceError);
});

test("requests exact selected filters from the configured official resource", async () => {
  clearMandiPriceCache();
  let requestedUrl;
  const result = await fetchMandiPrices({
    commodity: "Rice",
    state: "Andhra Pradesh",
    district: "Kurnool",
    market: "Kurnool"
  }, {
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return response({ total: 1, records: [rice] });
    },
    now: 1
  });

  assert.equal(requestedUrl.hostname, "api.data.gov.in");
  assert.equal(requestedUrl.pathname, "/resource/9ef84268-d588-465a-a308-a864a43d0070");
  assert.equal(requestedUrl.searchParams.get("filters[commodity]"), "Rice");
  assert.equal(requestedUrl.searchParams.get("filters[state]"), "Andhra Pradesh");
  assert.equal(requestedUrl.searchParams.get("filters[district]"), "Kurnool");
  assert.equal(requestedUrl.searchParams.get("filters[market]"), "Kurnool");
  assert.equal(requestedUrl.searchParams.get("api-key"), "test-key");
  assert.equal(JSON.stringify(result).includes("test-key"), false);
  assert.equal(result.records[0].commodity, "Rice");
});

test("sends all supported exact filters and converts selected report date for data.gov.in", async () => {
  clearMandiPriceCache();
  let requestedUrl;
  const result = await fetchMandiPrices({
    commodity: "Rice",
    state: "Andhra Pradesh",
    district: "Kurnool",
    market: "Kurnool",
    variety: "Common",
    reportDate: "2026-10-11"
  }, {
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return response({ total: 1, records: [rice] });
    },
    now: 10
  });

  assert.equal(requestedUrl.searchParams.get("filters[commodity]"), "Rice");
  assert.equal(requestedUrl.searchParams.get("filters[state]"), "Andhra Pradesh");
  assert.equal(requestedUrl.searchParams.get("filters[district]"), "Kurnool");
  assert.equal(requestedUrl.searchParams.get("filters[market]"), "Kurnool");
  assert.equal(requestedUrl.searchParams.get("filters[variety]"), "Common");
  assert.equal(requestedUrl.searchParams.get("filters[arrival_date]"), "11/10/2026");
  assert.equal(result.records[0].reportDate, "2026-10-11");
});

test("normalizes redundant whitespace but does not merge distinct official names", async () => {
  clearMandiPriceCache();
  const matching = await fetchMandiPrices({
    commodity: "Rice",
    state: " Andhra   Pradesh ",
    district: "Kurnool",
    market: " Kurnool ",
    reportDate: "2026-10-11"
  }, {
    fetchImpl: async () => response({
      total: 1,
      records: [{ ...rice, state: "Andhra Pradesh", market: "Kurnool" }]
    }),
    now: 11
  });
  assert.equal(matching.count, 1);

  clearMandiPriceCache();
  const differentCase = await fetchMandiPrices({
    commodity: "rice",
    state: "Andhra Pradesh"
  }, {
    fetchImpl: async () => response({ total: 1, records: [rice] }),
    now: 12
  });
  assert.equal(differentCase.count, 0);

  clearMandiPriceCache();
  const differentMarket = await fetchMandiPrices({
    commodity: "Rice",
    state: "Andhra Pradesh",
    district: "Kurnool",
    market: "Madanapalli"
  }, {
    fetchImpl: async () => response({
      total: 1,
      records: [{ ...rice, market: "Madanapalli APMC" }]
    }),
    now: 13
  });
  assert.equal(differentMarket.count, 0);
  assert.deepEqual(differentMarket.diagnostics.filterMismatches.find(item => item.field === "market"), {
    field: "market",
    requested: "Madanapalli",
    returned: ["Madanapalli APMC"]
  });
});

test("deduplicates identical official records using their source fields including grade", async () => {
  clearMandiPriceCache();
  const result = await fetchMandiPrices({ commodity: "Rice" }, {
    fetchImpl: async () => response({
      total: 3,
      records: [rice, { ...rice }, { ...rice, grade: "A" }]
    }),
    now: 14
  });
  assert.equal(result.records.length, 2);
  assert.equal(result.diagnostics.duplicateRecordCount, 1);
  assert.notEqual(result.records[0].id, result.records[1].id);
});

test("preserves selected filters and reports empty official results without substitution", async () => {
  clearMandiPriceCache();
  const result = await fetchMandiPrices({
    commodity: "Rice",
    state: "Andhra Pradesh",
    district: "Kurnool",
    market: "Kurnool",
    variety: "Common",
    reportDate: "2026-10-11"
  }, {
    fetchImpl: async () => response({ total: 0, records: [] }),
    now: 15
  });

  assert.deepEqual(result.records, []);
  assert.equal(result.diagnostics.apiReportedTotal, 0);
  assert.equal(result.diagnostics.recordsInspected, 0);
  assert.equal(result.diagnostics.filterMismatchCount, 0);
  assert.deepEqual(result.diagnostics.requestedFilters, {
    commodity: "Rice",
    state: "Andhra Pradesh",
    district: "Kurnool",
    market: "Kurnool",
    variety: "Common",
    reportDate: "2026-10-11"
  });
});

test("surfaces rate limits after respecting Retry-After", async () => {
  clearMandiPriceCache();
  let calls = 0;
  await assert.rejects(
    fetchMandiPrices({ commodity: "Rice" }, {
      fetchImpl: async () => {
        calls += 1;
        return response({}, 429, { "retry-after": "0" });
      },
      now: 16
    }),
    error => error instanceof MandiPriceError && error.code === "MARKET_API_RATE_LIMITED"
  );
  assert.equal(calls, 4);
});

test("diagnostics checks the configured data.gov.in resource", async () => {
  const result = await diagnoseMandiApi({ fetchImpl: async () => response({ total: 4, records: [rice] }) });
  assert.equal(result.reachable, true);
  assert.equal(result.recordCount, 4);
  assert.equal(result.code, "OK");
});

test("normalizes supported upstream date representations before comparing report dates", async () => {
  clearMandiPriceCache();
  for (const [index, arrivalDate] of ["11/10/2026", "11-10-2026", "2026-10-11", "1/10/2026"].entries()) {
    const result = await fetchMandiPrices({
      commodity: "Rice",
      reportDate: "2026-10-11"
    }, {
      fetchImpl: async () => response({
        total: 1,
        records: [{ ...rice, arrival_date: arrivalDate }]
      }),
      now: 20 + index
    });
    assert.equal(result.count, arrivalDate === "1/10/2026" ? 0 : 1, `date ${arrivalDate} normalization should be exact`);
    clearMandiPriceCache();
  }
});

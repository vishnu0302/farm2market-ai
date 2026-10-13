
import "dotenv/config";

const API_BASE_URL = "https://api.data.gov.in/resource";
const RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_RECORDS = 100;
const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_MAX_RETRIES = 3;
const REQUEST_PAGE_DELAY_MS = 500;
const MAX_CACHE_ENTRIES = 100;
const LOCATION_PAGE_SIZE = 1000;
const DATA_GOV_RESULT_WINDOW = 10000;

const cache = new Map();

const FILTER_FIELDS = Object.freeze({
  commodity: "commodity",
  state: "state",
  district: "district",
  market: "market",
  variety: "variety",
  reportDate: "reportDate",
});

export class MandiPriceError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "MandiPriceError";
    this.code = code;
    this.status = status;
  }
}

function cleanFilter(value, name, maxLength = 80) {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value !== "string") {
    throw new MandiPriceError("INVALID_INPUT", `${name} must be text.`, 400);
  }

  const clean = value.trim();

  if (
    clean.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(clean)
  ) {
    throw new MandiPriceError("INVALID_INPUT", `${name} is invalid.`, 400);
  }

  return clean;
}

export function isValidReportDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function validateMandiFilters(input = {}) {
  const filters = Object.fromEntries(
    Object.keys(FILTER_FIELDS).map((key) => [
      key,
      cleanFilter(input[key], key, key === "commodity" ? 60 : 80),
    ])
  );

  if (!filters.commodity) {
    throw new MandiPriceError(
      "INVALID_INPUT",
      "Choose a commodity to search.",
      400
    );
  }

  if (filters.reportDate && !isValidReportDate(filters.reportDate)) {
    throw new MandiPriceError(
      "INVALID_INPUT",
      "Report date must use YYYY-MM-DD.",
      400
    );
  }

  return filters;
}

export function validatePagination(input = {}) {
  const limit =
    input.limit === undefined || input.limit === ""
      ? DEFAULT_LIMIT
      : Number(input.limit);

  const offset =
    input.offset === undefined || input.offset === ""
      ? 0
      : Number(input.offset);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS) {
    throw new MandiPriceError(
      "INVALID_INPUT",
      `limit must be an integer from 1 to ${MAX_RECORDS}.`,
      400
    );
  }

  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + limit > DATA_GOV_RESULT_WINDOW
  ) {
    throw new MandiPriceError(
      "INVALID_INPUT",
      `offset plus limit must not exceed the data.gov.in result window of ${DATA_GOV_RESULT_WINDOW}.`,
      400
    );
  }

  return { limit, offset };
}

function price(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const number = Number(String(value).replaceAll(",", "").trim());

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : value === null || value === undefined
      ? ""
      : String(value).replace(/\s+/g, " ").trim();
}

function dateValue(value) {
  const clean = text(value);

  if (isValidReportDate(clean)) return clean;

  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(clean);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";

  return isValidReportDate(iso) ? iso : null;
}

function normalizeFilterValue(value) {
  return text(value);
}

function mandiRecordMatchesFilters(record, filters) {
  return (
    (!filters.commodity || normalizeFilterValue(record.commodity) === normalizeFilterValue(filters.commodity)) &&
    (!filters.state || normalizeFilterValue(record.state) === normalizeFilterValue(filters.state)) &&
    (!filters.district || normalizeFilterValue(record.district) === normalizeFilterValue(filters.district)) &&
    (!filters.market || normalizeFilterValue(record.market) === normalizeFilterValue(filters.market)) &&
    (!filters.variety || normalizeFilterValue(record.variety) === normalizeFilterValue(filters.variety)) &&
    (!filters.reportDate || dateValue(record.reportDate) === dateValue(filters.reportDate))
  );
}

function describeFilterMismatches(records, filters) {
  const fields = ["commodity", "state", "district", "market", "variety", "reportDate"];
  const mismatches = [];

  for (const field of fields) {
    const requested = filters[field];
    if (!requested) continue;
    const returned = [...new Set(records
      .filter(record => {
        if (field === "reportDate") {
          return dateValue(record.reportDate) !== dateValue(requested);
        }
        return normalizeFilterValue(record[field]) !== normalizeFilterValue(requested);
      })
      .map(record => record[field])
      .filter(Boolean))].slice(0, 5);
    if (returned.length) mismatches.push({ field, requested, returned });
  }

  return mismatches;
}

export function mapMandiRecord(record, retrievedAt = new Date()) {
  if (!record || typeof record !== "object") return null;

  const reportDate = dateValue(
    record.arrival_date ??
    record.Arrival_Date ??
    record.reported_date
  );

  const modal = price(
    record.modal_price ??
    record.model_price ??
    record.Modal_Price
  );

  const state = text(record.state ?? record.state_name ?? record.State);
  const district = text(
    record.district ?? record.district_name ?? record.District
  );
  const market = text(
    record.market ?? record.market_name ?? record.Market
  );
  const commodity = text(
    record.commodity ?? record.cmdt_name ?? record.Commodity
  );

  if (
    !reportDate ||
    modal === null ||
    modal <= 0 ||
    !state ||
    !district ||
    !market ||
    !commodity
  ) {
    return null;
  }

  const variety = text(record.variety ?? record.variety_name);
  const grade = text(record.grade ?? record.Grade);
  const min = price(record.min_price ?? record.Min_Price);
  const max = price(record.max_price ?? record.Max_Price);

  // data.gov.in's daily mandi-price dataset reports prices per quintal.
  const minPerQuintal = min;
  const maxPerQuintal = max;
  const modalPerQuintal = modal;

  return {
    id: JSON.stringify([
      state,
      district,
      market,
      commodity,
      variety,
      grade,
      reportDate,
      min,
      max,
      modal,
    ]),

    commodity,
    variety,
    grade,
    state,
    district,
    market,
    reportDate,

    reportedMinPrice: min,
    reportedMaxPrice: max,
    reportedModalPrice: modal,

    priceUnit: "₹/quintal",
    sourceUnit: "INR_PER_QUINTAL",
    priceUnitVerified: true,

    minPricePerKg: minPerQuintal === null ? null : minPerQuintal / 100,
    maxPricePerKg: maxPerQuintal === null ? null : maxPerQuintal / 100,
    modalPricePerKg: modalPerQuintal / 100,

    minPricePerQuintal: minPerQuintal,
    maxPricePerQuintal: maxPerQuintal,
    modalPricePerQuintal: modalPerQuintal,

    dataSource: "data.gov.in",
    retrievedAt: retrievedAt.toISOString(),
  };
}

async function requestJson(url, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (typeof fetchImpl !== "function") {
    throw new MandiPriceError(
      "MARKET_API_NETWORK_ERROR",
      "Fetch is not available in this Node.js environment.",
      503
    );
  }

  let response;

  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const requestError = new MandiPriceError(
      error.name === "TimeoutError" || error.name === "AbortError"
        ? "MARKET_API_TIMEOUT"
        : "MARKET_API_NETWORK_ERROR",
      "Could not connect to data.gov.in.",
      503
    );
    throw requestError;
  }

  let payload;

  if (!response.ok) {
    const code = response.status === 429
      ? "MARKET_API_RATE_LIMITED"
      : response.status >= 500
        ? "MARKET_API_SERVER_ERROR"
        : "MARKET_API_HTTP_ERROR";
    const error = new MandiPriceError(
      code,
      `data.gov.in rejected the request (HTTP ${response.status}).`,
      response.status === 429 || response.status >= 500 ? 503 : 502
    );
    const retryAfter = response.headers?.get?.("retry-after");
    if (retryAfter) {
      const retrySeconds = Number(retryAfter);
      const retryDate = Date.parse(retryAfter);
      error.retryAfterMs = Number.isFinite(retrySeconds)
        ? Math.max(0, retrySeconds * 1000)
        : Number.isFinite(retryDate)
          ? Math.max(0, retryDate - Date.now())
          : undefined;
    }
    error.upstreamStatus = response.status;
    throw error;
  }

  try {
    payload = await response.json();
  } catch {
    throw new MandiPriceError(
      "MARKET_API_INVALID_RESPONSE",
      "data.gov.in returned unreadable data.",
      502
    );
  }

  if (Number.isInteger(payload?.status) && payload.status >= 400) {
    const code = payload.status === 429
      ? "MARKET_API_RATE_LIMITED"
      : payload.status >= 500
        ? "MARKET_API_SERVER_ERROR"
        : "MARKET_API_HTTP_ERROR";
    const error = new MandiPriceError(
      code,
      `data.gov.in rejected the request (HTTP ${payload.status}).`,
      payload.status === 429 || payload.status >= 500 ? 503 : 502
    );
    error.upstreamStatus = payload.status;
    throw error;
  }
  if (payload?.status === "error" || payload?.error) {
    const error = new MandiPriceError(
      "MARKET_API_SERVER_ERROR",
      "data.gov.in reported an upstream query error.",
      502
    );
    throw error;
  }

  return payload;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestJsonWithRetries(url, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJson(url, fetchImpl, timeoutMs);
    } catch (error) {
      const retryable = [
        "MARKET_API_RATE_LIMITED",
        "MARKET_API_SERVER_ERROR",
        "MARKET_API_NETWORK_ERROR",
        "MARKET_API_TIMEOUT"
      ].includes(error.code);
      if (!retryable || attempt >= REQUEST_MAX_RETRIES) throw error;
      await wait(error.retryAfterMs ?? 1000 * (2 ** attempt));
    }
  }
}

function buildDataGovUrl(filters, apiKey, limit, offset) {
  const url = new URL(`${API_BASE_URL}/${RESOURCE_ID}`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  for (const [field, value] of Object.entries(filters)) {
    if (value) url.searchParams.set(`filters[${field}]`, value);
  }
  return url;
}

function cacheKey(filters, limit, offset) {
  return JSON.stringify({ filters, limit, offset });
}

export function clearMandiPriceCache() {
  cache.clear();
}

export async function fetchMandiPrices(
  input,
  {
    fetchImpl = globalThis.fetch,
    now = Date.now(),
    limit: requestedLimit,
    offset: requestedOffset,
  } = {}
) {
  const filters = validateMandiFilters(input);
  const { limit, offset } = validatePagination({
    limit: requestedLimit,
    offset: requestedOffset,
  });

  const key = cacheKey(filters, limit, offset);
  const cached = cache.get(key);

  if (cached && now - cached.cachedAt <= CACHE_TTL_MS) {
    return { ...cached.value, cacheStatus: "HIT" };
  }

  const apiKey = process.env.DATA_GOV_IN_API_KEY;

  if (!apiKey) {
    throw new MandiPriceError(
      "PRICE_DATA_UNAVAILABLE",
      "The data.gov.in API key is not configured.",
      503
    );
  }

  const apiFilters = {
    commodity: filters.commodity,
    state: filters.state,
    district: filters.district,
    market: filters.market,
    variety: filters.variety,
  };
  if (filters.reportDate) {
    const [year, month, day] = filters.reportDate.split("-");
    apiFilters.arrival_date = `${day}/${month}/${year}`;
  }
  const url = buildDataGovUrl(apiFilters, apiKey, limit, offset);
  const payload = await requestJsonWithRetries(url, fetchImpl);
  if (!Array.isArray(payload.records)) {
    throw new MandiPriceError(
      "MARKET_API_INVALID_RESPONSE",
      "data.gov.in returned no valid price-record list.",
      502
    );
  }
  const rawRecords = payload.records;
  const rawTotal = typeof payload.total === "number"
    ? payload.total
    : typeof payload.total === "string" && payload.total.trim()
      ? Number(payload.total)
      : Number.NaN;
  if (!Number.isSafeInteger(rawTotal) || rawTotal < 0 ||
    rawRecords.length > limit || rawRecords.length !== Math.min(limit, Math.max(0, rawTotal - offset))) {
    throw new MandiPriceError(
      "MARKET_API_INVALID_RESPONSE",
      "data.gov.in returned an incomplete filtered price page.",
      502
    );
  }
  if (payload.offset !== undefined && Number(payload.offset) !== offset) {
    throw new MandiPriceError(
      "MARKET_API_INVALID_RESPONSE",
      "data.gov.in returned a filtered price page at an unexpected offset.",
      502
    );
  }
  const retrievedAt = new Date(now);
  const mappedRecords = rawRecords
    .map(record => mapMandiRecord(record, retrievedAt))
    .filter(Boolean);
  const matchingRecords = mappedRecords
    .filter(record => mandiRecordMatchesFilters(record, filters));
  const records = [...new Map(matchingRecords.map(record => [record.id, record])).values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate));

  const total = rawTotal;

  const result = {
    records,
    count: records.length,
    total,
    limit,
    offset,
    hasMore: offset + limit < Math.min(total, DATA_GOV_RESULT_WINDOW),
    truncated: total > DATA_GOV_RESULT_WINDOW,
    retrievedAt: retrievedAt.toISOString(),
    dataSource: "data.gov.in",
    sourceUnit: "INR_PER_QUINTAL",
    priceUnit: "₹/quintal",
    cacheStatus: "MISS",
    diagnostics: {
      requestedFilters: filters,
      apiReportedTotal: total,
      recordsInspected: rawRecords.length,
      validRecords: mappedRecords.length,
      filterMismatchCount: mappedRecords.length - matchingRecords.length,
      duplicateRecordCount: matchingRecords.length - records.length,
      filterMismatches: describeFilterMismatches(mappedRecords, filters),
    },
  };

  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, { cachedAt: now, value: result });

  return result;
}

export async function fetchMandiLocationRecords({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  pageSize = LOCATION_PAGE_SIZE,
  resultWindow = DATA_GOV_RESULT_WINDOW,
} = {}) {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey) {
    throw new MandiPriceError("PRICE_DATA_UNAVAILABLE", "The data.gov.in API key is not configured.", 503);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
    !Number.isInteger(resultWindow) || resultWindow < pageSize || resultWindow > DATA_GOV_RESULT_WINDOW) {
    throw new MandiPriceError("INVALID_INPUT", "Location page size is invalid.", 400);
  }

  async function fetchPage(filters, offset, expectedTotal = null) {
    const limit = Math.min(pageSize, resultWindow - offset);
    const payload = await requestJsonWithRetries(
      buildDataGovUrl(filters, apiKey, limit, offset),
      fetchImpl
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new MandiPriceError(
        "MARKET_API_INVALID_RESPONSE",
        "data.gov.in returned an invalid mandi-location response.",
        502
      );
    }
    const rawTotal = payload.total;
    const total = typeof rawTotal === "number"
      ? rawTotal
      : typeof rawTotal === "string" && rawTotal.trim()
        ? Number(rawTotal)
        : Number.NaN;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new MandiPriceError(
        "MARKET_API_INVALID_RESPONSE",
        "data.gov.in returned an invalid total for mandi locations.",
        502
      );
    }
    if (expectedTotal !== null && total !== expectedTotal) {
      throw new MandiPriceError(
        "MARKET_API_INCOMPLETE_LOCATION_DATA",
        "data.gov.in changed its reported total while the location catalog was being retrieved.",
        502
      );
    }
    if (payload.offset !== undefined && Number(payload.offset) !== offset) {
      throw new MandiPriceError(
        "MARKET_API_INCOMPLETE_LOCATION_DATA",
        "data.gov.in returned a location page at an unexpected offset.",
        502
      );
    }
    const records = payload.records;
    const expectedCount = Math.min(limit, Math.max(0, total - offset));
    if (!Array.isArray(records) || records.length !== expectedCount) {
      throw new MandiPriceError(
        records?.length === 0 && offset < total
          ? "MARKET_API_INCOMPLETE_LOCATION_DATA"
          : "MARKET_API_INVALID_RESPONSE",
        "data.gov.in returned an incomplete mandi-location page.",
        502
      );
    }
    return { records, total };
  }

  async function fetchFilteredRecords(filters, { allowPrefix = false } = {}) {
    const records = [];
    let total = null;
    for (let offset = 0; total === null || (offset < total && (!allowPrefix || offset < resultWindow));) {
      if (!allowPrefix && offset >= resultWindow) {
        throw new MandiPriceError(
          "MARKET_API_INCOMPLETE_LOCATION_DATA",
          "A mandi-location partition exceeds the data.gov.in 10,000-record result window.",
          502
        );
      }
      if (offset > 0) await wait(REQUEST_PAGE_DELAY_MS);
      const page = await fetchPage(filters, offset, total);
      total = page.total;
      records.push(...page.records);
      offset += page.records.length;
    }
    return { records, total };
  }

  const globalPrefix = await fetchFilteredRecords({}, { allowPrefix: true });
  let completeRecords = globalPrefix.records;
  if (globalPrefix.total > resultWindow) {
    const states = [...new Set(globalPrefix.records
      .map(record => text(record.state ?? record.state_name ?? record.State))
      .filter(Boolean))];
    if (states.length === 0) {
      throw new MandiPriceError(
        "MARKET_API_INCOMPLETE_LOCATION_DATA",
        "The official location records did not contain state names needed to retrieve the full catalog.",
        502
      );
    }

    completeRecords = [];
    let partitionTotal = 0;
    for (const state of states) {
      const partition = await fetchFilteredRecords({ state });
      const exactStateRecords = partition.records.filter(record =>
        text(record.state ?? record.state_name ?? record.State) === state
      );
      partitionTotal += exactStateRecords.length;
      completeRecords.push(...exactStateRecords);
    }
    if (partitionTotal !== globalPrefix.total) {
      throw new MandiPriceError(
        "MARKET_API_INCOMPLETE_LOCATION_DATA",
        `The official location catalog could not be completely partitioned by state (${partitionTotal} of ${globalPrefix.total} reported rows were covered).`,
        502
      );
    }
  }

  const locations = new Map();
  const commodities = new Set();
  for (const record of completeRecords) {
    const state = text(record.state ?? record.state_name ?? record.State);
    const district = text(record.district ?? record.district_name ?? record.District);
    const market = text(record.market ?? record.market_name ?? record.Market);
    const commodity = text(record.commodity ?? record.cmdt_name ?? record.Commodity);
    if (state && district && market) {
      const key = JSON.stringify([state, district, market]);
      locations.set(key, { state, district, market });
    }
    if (commodity) commodities.add(commodity);
  }

  const values = [...locations.values()].sort((a, b) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district) || a.market.localeCompare(b.market));
  if (values.length === 0 || commodities.size === 0) {
    throw new MandiPriceError(
      "MARKET_API_INCOMPLETE_LOCATION_DATA",
      "The official mandi resource did not provide a usable location and commodity catalog.",
      502
    );
  }
  return {
    locations: values,
    commodities: [...commodities].sort((a, b) => a.localeCompare(b)),
    retrievedAt: new Date(now).toISOString(),
    dataSource: "data.gov.in",
    total: globalPrefix.total
  };
}

export async function diagnoseMandiApi({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 5000,
} = {}) {
  try {
    const apiKey = process.env.DATA_GOV_IN_API_KEY;

    if (!apiKey) {
      return {
        configured: false,
        reachable: false,
        httpStatus: null,
        recordCount: null,
        code: "PRICE_DATA_UNAVAILABLE",
        checkedAt: new Date(now).toISOString(),
      };
    }

    const url = new URL(`${API_BASE_URL}/${RESOURCE_ID}`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const payload = await requestJson(url, fetchImpl, timeoutMs);

    return {
      configured: true,
      reachable: Array.isArray(payload.records),
      httpStatus: 200,
      recordCount: Number.isFinite(Number(payload.total))
        ? Number(payload.total)
        : null,
      code: "OK",
      checkedAt: new Date(now).toISOString(),
    };
  } catch (error) {
    return {
      configured: Boolean(process.env.DATA_GOV_IN_API_KEY),
      reachable: false,
      httpStatus: Number.isInteger(error.upstreamStatus)
        ? error.upstreamStatus
        : null,
      recordCount: null,
      code: error.code || "MARKET_API_ERROR",
      checkedAt: new Date(now).toISOString(),
    };
  }
}

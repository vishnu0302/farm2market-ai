
import { fetchMandiLocationRecords } from "./mandiPriceService.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
let cachedSnapshot = null;
let inFlightSnapshot = null;
let cacheGeneration = 0;

export function clearMandiLocationCache() {
  cachedSnapshot = null;
  inFlightSnapshot = null;
  cacheGeneration += 1;
}

export async function getMandiLocationSnapshot(options = {}) {
  const now = options.now ?? Date.now();
  if (cachedSnapshot && now - cachedSnapshot.cachedAt <= CACHE_TTL_MS) {
    return { ...cachedSnapshot.value, cacheStatus: "HIT" };
  }
  if (inFlightSnapshot) return inFlightSnapshot;

  const generation = cacheGeneration;
  const pending = (async () => {
    const result = await fetchMandiLocationRecords(options);
    const locations = result.locations;
    const value = {
      states: [...new Set(locations.map(location => location.state))],
      locations,
      commodities: result.commodities,
      source: result.dataSource,
      snapshotDate: new Date(now).toISOString().slice(0, 10),
      retrievedAt: result.retrievedAt,
      cacheStatus: "MISS"
    };
    if (generation === cacheGeneration) cachedSnapshot = { cachedAt: now, value };
    return value;
  })();
  inFlightSnapshot = pending;

  try {
    return await pending;
  } finally {
    if (inFlightSnapshot === pending) inFlightSnapshot = null;
  }
}

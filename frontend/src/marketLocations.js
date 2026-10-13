function normalizeLocationName(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function getMandiDistrictOptions(locations, state) {
  const selectedState = normalizeLocationName(state);
  if (!selectedState) return [];
  return [...new Set(locations
    .filter(location => normalizeLocationName(location.state) === selectedState)
    .map(location => location.district))].sort((a, b) => a.localeCompare(b));
}

export function getMandiMarketOptions(locations, state, district) {
  const selectedState = normalizeLocationName(state);
  const selectedDistrict = normalizeLocationName(district);
  if (!selectedState || !selectedDistrict) return [];
  return [...new Set(locations
    .filter(location =>
      normalizeLocationName(location.state) === selectedState &&
      normalizeLocationName(location.district) === selectedDistrict
    )
    .map(location => location.market))].sort((a, b) => a.localeCompare(b));
}

export function isMandiOptionSelected(options, value) {
  const selectedValue = normalizeLocationName(value);
  return Boolean(selectedValue && options.some(option => normalizeLocationName(option) === selectedValue));
}

export function updateMandiLocationFilters(filters, name, value) {
  if (name === "state") return { ...filters, state: value, district: "", market: "" };
  if (name === "district") return { ...filters, district: value, market: "" };
  return { ...filters, [name]: value };
}

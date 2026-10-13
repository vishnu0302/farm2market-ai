
const API_BASE_URL = "https://api.agmarknet.gov.in/v1";

const FILTERS_URL =
    `${API_BASE_URL}/dashboard-filters/?dashboard_name=marketwise_price_arrival`;

const REPORT_URL = `${API_BASE_URL}/dashboard-data/`;

/**
 * Fetch available filters from AGMARKNET.
 */
export async function fetchAgmarknetFilters() {
    const response = await fetch(FILTERS_URL, {
        method: "GET",
        headers: {
            Accept: "application/json, text/plain, */*",
            Origin: "https://agmarknet.gov.in",
            Referer: "https://agmarknet.gov.in/",
        },
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        const details = await response.text();

        console.error("AGMARKNET filters HTTP status:", response.status);
        console.error("AGMARKNET response:", details.slice(0, 1000));

        throw new Error(
            `AGMARKNET filters request failed: HTTP ${response.status}`
        );
    }

    const result = await response.json();

    if (result.status !== true) {
        throw new Error(result.message || "AGMARKNET filters were unavailable.");
    }

    return result.data;
}

/**
 * Fetch prices using the dashboard-data endpoint.
 *
 * Values must be actual IDs obtained from AGMARKNET's filters.
 * Do not pass guessed IDs.
 */
export async function fetchAgmarknetPrices({
    date,
    state,
    group,
    commodity,
    district,
    market,
    variety,
    grades,
    limit = 10,
}) {
    if (!date || state == null || group == null || commodity == null) {
        throw new Error("Date, state, group and commodity are required.");
    }

    const payload = {
        dashboard: "marketwise_price_arrival",
        date,
        group: [Number(group)],
        commodity: [Number(commodity)],
        state: Number(state),
        district: district == null ? [] : [Number(district)],
        market: market == null ? [] : [Number(market)],
        variety: variety == null ? null : Number(variety),
        grades: grades == null ? [] : [Number(grades)],
        format: "json",
        limit: Math.min(Math.max(Number(limit) || 10, 1), 50),
    };

    const response = await fetch(REPORT_URL, {
        method: "POST",
        headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: "https://agmarknet.gov.in",
            Referer: "https://agmarknet.gov.in/",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
    });

    const responseText = await response.text();

    let result;
    try {
        result = JSON.parse(responseText);
    } catch {
        throw new Error(
            `AGMARKNET returned a non-JSON response (HTTP ${response.status}).`
        );
    }

    if (!response.ok) {
        throw new Error(
            `AGMARKNET price request failed: HTTP ${response.status}.`
        );
    }

    if (result.status !== "success") {
        throw new Error(result.message || "AGMARKNET returned no successful report.");
    }

    return result;
}

/**
 * Convert a dashboard record into a safe, clearly labelled result.
 * This is a commodity-level dashboard price, not a market-specific quote.
 */
export function mapAgmarknetDashboardRecord(record) {
    if (!record || typeof record !== "object") {
        return null;
    }

    const price = Number(record.as_on_price);

    return {
        commodity: record.cmdt_name || "Unknown commodity",
        reportedDate: record.reported_date || null,
        dashboardPricePerQuintal:
            Number.isFinite(price) && price > 0 ? price : null,
        priceUnit: "INR_PER_QUINTAL",
        previousDayPricePerQuintal:
            Number.isFinite(Number(record.one_day_ago_price)) &&
                Number(record.one_day_ago_price) > 0
                ? Number(record.one_day_ago_price)
                : null,
        twoDaysAgoPricePerQuintal:
            Number.isFinite(Number(record.two_day_ago_price)) &&
                Number(record.two_day_ago_price) > 0
                ? Number(record.two_day_ago_price)
                : null,
        arrivalMetricTonnes:
            Number.isFinite(Number(record.as_on_arrival)) &&
                Number(record.as_on_arrival) >= 0
                ? Number(record.as_on_arrival)
                : null,
        mspPerQuintal:
            Number.isFinite(Number(record.msp_price)) &&
                Number(record.msp_price) > 0
                ? Number(record.msp_price)
                : null,
        source: "AGMARKNET 2.0",
        priceType: "commodity_dashboard",
    };
}


import "dotenv/config";

const API_KEY = process.env.DATA_GOV_IN_API_KEY;

const RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";

async function testApi() {
    if (!API_KEY) {
        console.log("API key not found. Check your backend .env file.");
        return;
    }

    const url = new URL(
        `https://api.data.gov.in/resource/${RESOURCE_ID}`
    );

    url.searchParams.set("api-key", API_KEY);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");

    try {
        console.log("Testing data.gov.in connection...");

        const response = await fetch(url);

        console.log("HTTP status:", response.status);

        const result = await response.json();

        if (!response.ok) {
            console.log("API request failed:", result.message || result.error || "Unknown error");
            return;
        }

        console.log("Total records:", result.total);

        if (result.records?.length) {
            console.log("Sample mandi records:");
            console.log(JSON.stringify(result.records, null, 2));
        } else {
            console.log("No records returned. Check the API response.");
        }
    } catch (error) {
        console.log("Connection error:", error.message);
    }
}

testApi();


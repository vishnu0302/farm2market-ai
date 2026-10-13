
import {
    mapAgmarknetDashboardRecord,
} from "./src/services/agmarknetService.js";

const sample = {
    cmdt_name: "Tomato",
    msp_price: null,
    as_on_price: "2400.00",
    as_on_arrival: "90.00",
    reported_date: "10-10-2026",
    one_day_ago_price: "2200.00",
    two_day_ago_price: "2400.00",
};

console.log(
    JSON.stringify(mapAgmarknetDashboardRecord(sample), null, 2)
);

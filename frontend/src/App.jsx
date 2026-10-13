import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n.js";
import { QRCodeSVG } from "qrcode.react";
import { Sprout, ArrowRight, Languages, ShieldCheck, TrendingUp, PackageCheck, Truck, Warehouse, Store, LogOut, Leaf, Plus, MapPin, CalendarDays, IndianRupee, RefreshCw } from "lucide-react";
import { apiRequest } from "./api.js";
import { ApiError, apiNoticeMessage } from "./apiErrors.js";
import "./marketComparison.css";
import { getMandiDistrictOptions, getMandiMarketOptions, isMandiOptionSelected, updateMandiLocationFilters } from "./marketLocations.js";
import "./accessibility.css";

const roles = [
  { id: "farmer", icon: Sprout, color: "green" },
  { id: "trader", icon: Store, color: "blue" },
  { id: "warehouse", icon: Warehouse, color: "amber" },
  { id: "transporter", icon: Truck, color: "purple" }
];

const languageNames = { en: "English", te: "తెలుగు", hi: "हिन्दी", ta: "தமிழ்" };
const tx = (key, options) => i18n.t(`ui.${key}`, options);

function messageText(message) {
  if (message instanceof ApiError) return message.message;
  if (message instanceof Error) return tx("apiErrorUnknown");
  if (message?.translationKey) return tx(message.translationKey, message.options);
  if (message?.noticeCode) return apiNoticeMessage(message.noticeCode);
  return message || "";
}

function marketStatusErrorKey(code) {
  const keys = {
    MARKET_API_KEY_REJECTED: "apiErrorMarketKeyRejected",
    MARKET_API_FORBIDDEN: "apiErrorMarketForbidden",
    MARKET_API_RATE_LIMITED: "apiErrorMarketRateLimited",
    MARKET_API_TIMEOUT: "apiErrorMarketTimeout",
    MARKET_API_SERVER_ERROR: "apiErrorMarketServerError",
    MARKET_API_HTTP_ERROR: "apiErrorMarketHttpError",
    MARKET_API_INVALID_RESPONSE: "apiErrorMarketInvalidResponse",
    MARKET_API_SCHEMA_UNRECOGNIZED: "apiErrorMarketInvalidResponse"
  };
  return keys[code] || "apiErrorMarketNetworkError";
}

function validationMessageFor(control) {
  const validity = control.validity;
  if (validity.valueMissing) return tx("validationRequired");
  if (validity.typeMismatch && control.type === "email") return tx("validationEmail");
  if (validity.badInput) return tx("validationNumber");
  if (validity.tooShort) return tx("validationMinLength", { min: control.minLength });
  if (validity.tooLong) return tx("validationMaxLength", { max: control.maxLength });
  if (validity.rangeUnderflow) return tx("validationMinimum", { min: control.min });
  if (validity.rangeOverflow) return tx("validationMaximum", { max: control.max });
  return tx("validationField");
}

function localizeRiskText(text) {
  const exactKeys = {
    "A valid harvest date on or before today is needed to estimate risk.": "riskNeedHarvest",
    "A valid storage date and storage type are needed for the recorded stored quantity.": "riskNeedStorage",
    "Storage details are not available within this account's current permissions, so a complete risk rating cannot be calculated.": "riskNoStoragePermission",
    "A valid expected delivery date and recorded delivery status date are needed.": "riskNeedDeliveryDates",
    "No elevated-risk rules were triggered by the recorded harvest, storage, or delivery information.": "riskNoRulesTriggered",
    "Consider earlier dispatch": "alertEarlierDispatch",
    "Long storage duration": "alertLongStorage",
    "Delivery is past its expected date": "alertDeliveryLate"
  };
  if (exactKeys[text]) return tx(exactKeys[text]);
  const harvest = /^Harvest was recorded (\d+) days ago \((14\+|7–13) day age rule\)\.$/.exec(text);
  if (harvest) return tx("riskHarvestAge", { days: harvest[1], rule: harvest[2] });
  const storage = /^Stored quantity has remained in storage for (at least )?(\d+) days \((14\+|7–13) day storage rule\)\.$/.exec(text);
  if (storage) return tx("riskStorageAge", { atLeast: storage[1] ? tx("atLeast") : "", days: storage[2], rule: storage[3] });
  const ambient = /^Ambient storage is recorded for at least (\d+) days \(additional 7\+ day ambient rule\)\.$/.exec(text);
  if (ambient) return tx("riskAmbientAge", { days: ambient[1] });
  const dispatch = /^Recorded harvest age or storage duration has crossed a dispatch-priority rule\. Consider checking this batch and arranging dispatch sooner\.$/.exec(text);
  if (dispatch) return tx("riskDispatchExplanation");
  const longStorage = /^A remaining quantity has been recorded in storage for at least (\d+) days\.$/.exec(text);
  if (longStorage) return tx("riskLongStorageExplanation", { days: longStorage[1] });
  const delayed = /^(\d+) active or completed delivery records? (is|are) past the manually entered expected delivery date\. Check the recorded status with the transporter\.$/.exec(text);
  if (delayed) return tx("riskDelayedDelivery", { count: delayed[1] });
  const assessmentDelay = /^(\d+) delivery records? (is|are) past the expected delivery date \(up to (\d+) days? late\)\.$/.exec(text);
  if (assessmentDelay) return tx("riskAssessmentDelay", { count: assessmentDelay[1], days: assessmentDelay[3] });
  const title = /^(Low|Medium|High) rule-based risk$/.exec(text);
  if (title) return tx("alertRiskTitle", { level: tx(title[1]) });
  return text;
}

function localizeMilestoneLabel(label) {
  const patterns = [
    [/^Latest batch status recorded: (.+)$/, "timelineBatchStatus"],
    [/^Latest warehouse record: (.+)$/, "timelineWarehouseStatus"],
    [/^Delivery status recorded: (.+)$/, "timelineDeliveryStatus"],
    [/^Purchase interest status recorded: (.+)$/, "timelinePurchaseStatus"],
    [/^Current rule-based risk estimate: (.+)$/, "timelineRiskEstimate"]
  ];
  for (const [pattern, key] of patterns) {
    const match = pattern.exec(label);
    if (match) return tx(key, { status: tx(match[1]) });
  }
  return tx(label);
}

function isValidBatchId(batchId) {
  const match = /^FM-(\d{4})(\d{2})(\d{2})-[A-F0-9]{6}$/.exec(batchId);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
}

function getPublicBatchId(pathname) {
  const match = /^\/(?:trace|batches)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function downloadBatchQr(batchId) {
  const svg = document.getElementById(`batch-qr-${batchId}`);
  if (!(svg instanceof SVGElement)) return;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${batchId}-traceability-qr.svg`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatRecordedDate(value) {
  if (!value) return tx("notRecorded");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? tx("notRecorded") : date.toLocaleDateString(i18n.resolvedLanguage);
}

function DeliveryDetailsForm({ form, onChange, onSubmit, busy, mode, error }) {
  return (
    <form className="batch-form delivery-form" onSubmit={onSubmit} aria-describedby={error ? (mode === "request" ? "delivery-request-error" : "delivery-create-error") : undefined}>
      <label>{tx("existingPublishedBatch")}<input value={form.batchId} onChange={event => onChange("batchId", event.target.value.trim().toUpperCase())} required placeholder="FM-YYYYMMDD-XXXXXX" /></label>
      {mode === "request" && <label>{tx("transporterEmail")}<input type="email" value={form.transporterEmail} onChange={event => onChange("transporterEmail", event.target.value)} required placeholder="transporter@example.com" /></label>}
      <label>{tx("pickupLocation")}<input value={form.pickupLocation} onChange={event => onChange("pickupLocation", event.target.value)} minLength="2" maxLength="160" required placeholder={tx("villageMarketWarehouse")} /></label>
      <label>{tx("destination")}<input value={form.destination} onChange={event => onChange("destination", event.target.value)} minLength="2" maxLength="160" required placeholder={tx("deliveryDestination")} /></label>
      <label>{tx("quantityKg")}<input type="number" value={form.quantityKg} onChange={event => onChange("quantityKg", event.target.value)} min="0.01" max="100000000" step="0.01" required /></label>
      <label>{tx("estimatedCost")}<input type="number" value={form.estimatedTransportCost} onChange={event => onChange("estimatedTransportCost", event.target.value)} min="0" max="1000000000" step="0.01" required /></label>
      <label>{tx("dispatchDate")}<input type="date" value={form.dispatchDate} onChange={event => onChange("dispatchDate", event.target.value)} min={new Date().toISOString().slice(0, 10)} required /></label>
      <label>{tx("expectedDelivery")}<input type="date" value={form.expectedDeliveryDate} onChange={event => onChange("expectedDeliveryDate", event.target.value)} min={form.dispatchDate || new Date().toISOString().slice(0, 10)} required /></label>
      <button className="primary-button batch-submit" disabled={busy}>{busy ? tx("saving") : mode === "request" ? tx("shareRequest") : tx("createDeliveryRecord")}</button>
    </form>
  );
}

function DeliveryRequestCards({ requests, loading, onRespond, busyId }) {
  if (loading) return <p className="empty-batches" role="status">{tx("loadingSharedRequests")}</p>;
  if (requests.length === 0) return <div className="empty-batches"><strong>{tx("noPendingDelivery")}</strong><span>{tx("sharedWithAccount")}</span></div>;
  return <div className="delivery-card-grid">{requests.map(request => (
    <article className="delivery-card" key={request.id}>
      <div className="batch-card-top"><span className="batch-id">{request.batchId}</span><span className="interest-status pending">{tx("Requested")}</span></div>
      <h3>{request.cropName}</h3>
      <div className="delivery-route"><span><small>{tx("pickup")}</small><strong>{request.pickupLocation}</strong></span><ArrowRight size={16} aria-hidden="true" /><span><small>{tx("destination")}</small><strong>{request.destination}</strong></span></div>
      <div className="inventory-facts">
        <span>{tx("quantityKg")}<strong>{Number(request.quantityKg).toLocaleString()} kg</strong></span>
        <span>{tx("estimatedCost")}<strong>₹{Number(request.estimatedTransportCost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></span>
        <span>{tx("dispatchDate")}<strong>{new Date(request.dispatchDate).toLocaleDateString(i18n.resolvedLanguage)}</strong></span>
        <span>{tx("expectedDelivery")}<strong>{new Date(request.expectedDeliveryDate).toLocaleDateString(i18n.resolvedLanguage)}</strong></span>
        <span>{tx("estimatedDuration")}<strong>{request.estimatedDurationDays} {tx(request.estimatedDurationDays === 1 ? "day" : "days")}</strong></span>
      </div>
      <p className="manual-eta-note">{tx("manuallyEnteredNoGps")}</p>
      <div className="delivery-status-actions">
        <button type="button" className="offer-select" disabled={busyId === request.id} onClick={() => onRespond(request.id, "Accepted")}>{busyId === request.id ? tx("saving") : tx("acceptRequest")}</button>
        <button type="button" className="offer-select" disabled={busyId === request.id} onClick={() => onRespond(request.id, "Rejected")}>{busyId === request.id ? tx("saving") : tx("declineRequest")}</button>
      </div>
    </article>
  ))}</div>;
}

function DeliveryShareCards({ shares, loading }) {
  if (loading) return <p className="empty-batches" role="status">{tx("loadingSharedStatus")}</p>;
  if (shares.length === 0) return <div className="empty-batches"><strong>{tx("noSharedRequests")}</strong><span>{tx("requestsSharedByYou")}</span></div>;
  return <div className="interest-list">{shares.map(share => (
    <article className="interest-card" key={share.id}>
      <div><strong>{share.cropName} · {share.batchId}</strong><span>{Number(share.quantityKg).toLocaleString()} kg · {share.pickupLocation} to {share.destination}</span></div>
      <span className={`interest-status ${["Accepted", "Delivered"].includes(share.status) ? "accepted" : share.status === "Rejected" || share.status === "Cancelled" ? "rejected" : "pending"}`}>{share.status}</span>
    </article>
  ))}</div>;
}

function DeliveryCards({ deliveries, loading, onStatus, busyId }) {
  if (loading) return <p className="empty-batches" role="status">{tx("loadingDeliveries")}</p>;
  if (deliveries.length === 0) return <div className="empty-batches"><strong>{tx("noDeliveryRecords")}</strong><span>{tx("deliveryUpdates")}</span></div>;

  const transitions = {
    Requested: ["Accepted", "Cancelled"],
    Accepted: ["In Transit", "Cancelled"],
    "In Transit": ["Delivered", "Cancelled"],
    Delivered: [],
    Cancelled: []
  };
  return <div className="delivery-card-grid">{deliveries.map(delivery => (
    <article className="delivery-card" key={delivery.id}>
      <div className="batch-card-top"><span className="batch-id">{delivery.batchId}</span><span className={`interest-status ${delivery.status === "Delivered" ? "accepted" : delivery.status === "Cancelled" ? "rejected" : "pending"}`}>{delivery.status}</span></div>
      <h3>{delivery.cropName}</h3>
      <div className="delivery-route"><span><small>{tx("pickup")}</small><strong>{delivery.pickupLocation}</strong></span><ArrowRight size={16} aria-hidden="true" /><span><small>{tx("destination")}</small><strong>{delivery.destination}</strong></span></div>
      <div className="inventory-facts">
        <span>{tx("quantityKg")}<strong>{Number(delivery.quantityKg).toLocaleString()} kg</strong></span>
        <span>{tx("estimatedCost")}<strong>₹{Number(delivery.estimatedTransportCost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></span>
        <span>{tx("dispatchDate")}<strong>{new Date(delivery.dispatchDate).toLocaleDateString(i18n.resolvedLanguage)}</strong></span>
        <span>{tx("expectedDelivery")}<strong>{new Date(delivery.expectedDeliveryDate).toLocaleDateString(i18n.resolvedLanguage)}</strong></span>
        <span>{tx("estimatedDuration")}<strong>{delivery.estimatedDurationDays} {tx(delivery.estimatedDurationDays === 1 ? "day" : "days")}</strong></span>
      </div>
      <p className="manual-eta-note">{tx("manuallyEnteredNoGps")}</p>
      {onStatus && transitions[delivery.status].length > 0 && <div className="delivery-status-actions">{transitions[delivery.status].map(status => <button type="button" key={status} className="offer-select" disabled={busyId === delivery.id} onClick={() => onStatus(delivery.id, status)}>{busyId === delivery.id ? tx("updating") : tx(status)}</button>)}</div>}
    </article>
  ))}</div>;
}

function WarehouseAuthorizationList({ batches, busyId, onToggle }) {
  const eligibleBatches = batches.filter(batch =>
    batch.isPublished && ["Available", "Buyer interested", "Sold"].includes(batch.status)
  );
  if (eligibleBatches.length === 0) {
    return <div className="empty-batches"><strong>{tx("noEligibleBatches")}</strong><span>{tx("publishBeforePermission")}</span></div>;
  }
  return <div className="interest-list">{eligibleBatches.map(batch => (
    <article className="interest-card" key={batch.batchId}>
      <div><strong>{batch.cropName} · {batch.batchId}</strong><span>{batch.status} · {Number(batch.quantityKg).toLocaleString()} kg</span></div>
      <button
        type="button"
        className="offer-select"
        disabled={busyId === batch.batchId}
        aria-pressed={Boolean(batch.warehouseStorageAuthorized)}
        onClick={() => onToggle(batch)}
      >
        {busyId === batch.batchId
          ? tx("saving")
          : batch.warehouseStorageAuthorized
            ? tx("revokeStorage")
            : tx("authorizeStorage")}
      </button>
    </article>
  ))}</div>;
}

function SpoilageRiskPanel({ risks, alerts, loading, error, busyKey, onRefresh, onAcknowledge }) {
  return (
    <section className="risk-dashboard">
      <div className="batch-list-heading">
        <div><span className="eyebrow">{tx("ruleBased")}</span><h3>{tx("cropRisk")}</h3><p>{tx("riskIntro")}</p></div>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} aria-label={tx("refreshRisk")}><RefreshCw size={16} /></button>
      </div>
      {error && <p className="workflow-error" role="alert">{messageText(error)}</p>}
      {loading ? <p className="empty-batches" role="status">{tx("recalculating")}</p> : (
        <>
          <div className="risk-list">
            {risks.length === 0 ? <div className="empty-batches"><strong>{tx("noRelevantBatches")}</strong><span>{tx("riskAppears")}</span></div> : risks.map(risk => (
              <article className="risk-card" key={risk.batchId}>
                <div className="batch-card-top"><strong>{risk.cropName} · {risk.batchId}</strong><span className={`risk-level ${risk.level.toLowerCase().replaceAll(" ", "-")}`}>{tx(risk.level)}</span></div>
                <ul>{risk.explanations.map(explanation => <li key={explanation}>{localizeRiskText(explanation)}</li>)}</ul>
              </article>
            ))}
          </div>
          <div className="risk-alerts">
            <h4>{tx("urgentAlerts")}</h4>
            {alerts.length === 0 ? <div className="empty-batches"><strong>{tx("noPriorityAlerts")}</strong><span>{tx("newAlerts")}</span></div> : alerts.map(alert => (
              <article className={`risk-alert ${alert.level.toLowerCase()}`} key={alert.key}>
                <div className="risk-alert-copy">
                  <div className="risk-alert-title"><span className={`risk-level ${alert.level.toLowerCase()}`}>{tx(alert.level)}</span><strong>{localizeRiskText(alert.title)}</strong><span className="batch-id">{alert.cropName} · {alert.batchId}</span></div>
                  <p>{localizeRiskText(alert.explanation)}</p>
                </div>
                {alert.acknowledgedAt
                  ? <span className="alert-acknowledged">{tx("acknowledged")}</span>
                  : <button type="button" className="offer-select" disabled={busyKey === alert.key} onClick={() => onAcknowledge(alert.key)}>{busyKey === alert.key ? tx("saving") : tx("acknowledge")}</button>}
              </article>
            ))}
          </div>
        </>
      )}
      <p className="risk-disclaimer">{tx("riskDisclaimer")}</p>
    </section>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const publicBatchId = getPublicBatchId(window.location.pathname);
  const isPublicLookup = /^\/(?:trace|batches)\//.test(window.location.pathname);
  const [page, setPage] = useState("home");
  const [mode, setMode] = useState("signup");
  const [role, setRole] = useState("farmer");
  const [form, setForm] = useState({ name: "", email: "", password: "", preferredLanguage: i18n.language || "en" });
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fm_user") || "null"); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem("fm_token") || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState([]);
  const [marketOptions, setMarketOptions] = useState([]);
  const [offerCosts, setOfferCosts] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [marketDiagnostics, setMarketDiagnostics] = useState(null);
  const [marketFilters, setMarketFilters] = useState({ commodity: "", state: "", district: "", market: "", variety: "", reportDate: "" });
  const [marketLocations, setMarketLocations] = useState({ states: [], locations: [], commodities: [] });
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState("");
  const [locationsRetry, setLocationsRetry] = useState(0);
  const [marketStatus, setMarketStatus] = useState(null);
  const [marketStatusLoading, setMarketStatusLoading] = useState(false);
  const [marketOffset, setMarketOffset] = useState(0);
  const [marketHasMore, setMarketHasMore] = useState(false);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketSearchNonce, setMarketSearchNonce] = useState(0);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [marketplaceBatches, setMarketplaceBatches] = useState([]);
  const [purchaseInterests, setPurchaseInterests] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowBusyId, setWorkflowBusyId] = useState("");
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [warehouseFacilities, setWarehouseFacilities] = useState([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [warehouseInventory, setWarehouseInventory] = useState([]);
  const [oldestStoredInventory, setOldestStoredInventory] = useState([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseBusy, setWarehouseBusy] = useState(false);
  const [warehouseMessage, setWarehouseMessage] = useState("");
  const [warehouseError, setWarehouseError] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState("");
  const [inventoryCropFilter, setInventoryCropFilter] = useState("");
  const [outgoingQuantities, setOutgoingQuantities] = useState({});
  const [facilityForm, setFacilityForm] = useState({ name: "", location: "", capacityKg: "", supportedCropTypes: "" });
  const [incomingForm, setIncomingForm] = useState({ batchId: "", quantityKg: "", storageType: "Ambient", storageDate: new Date().toISOString().slice(0, 10) });
  const [deliveries, setDeliveries] = useState([]);
  const [deliveryRequests, setDeliveryRequests] = useState([]);
  const [deliveryShares, setDeliveryShares] = useState([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryBusyId, setDeliveryBusyId] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [riskData, setRiskData] = useState({ risks: [], alerts: [] });
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [riskBusyKey, setRiskBusyKey] = useState("");
  const [deliveryForm, setDeliveryForm] = useState({
    batchId: "",
    transporterEmail: "",
    pickupLocation: "",
    destination: "",
    quantityKg: "",
    estimatedTransportCost: "",
    dispatchDate: new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  });
  const [publicBatch, setPublicBatch] = useState(null);
  const [publicBatchLoading, setPublicBatchLoading] = useState(false);
  const [publicBatchError, setPublicBatchError] = useState("");
  const [publicBatchRetry, setPublicBatchRetry] = useState(0);
  const [batchForm, setBatchForm] = useState({ cropName: "Rice", variety: "", quantityKg: "500", harvestDate: new Date().toISOString().slice(0, 10), farmLocation: "", marketIndex: "0" });

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage || "en";
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    document.querySelectorAll(".app-shell input, .app-shell select, .app-shell textarea")
      .forEach(control => control.setCustomValidity(""));
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    if (user && token && !isPublicLookup) setPage("dashboard");
  }, []); // restore saved starter session on initial load

  useEffect(() => {
    if (!isPublicLookup) return;
    if (!publicBatchId || !isValidBatchId(publicBatchId)) {
      setPublicBatchError({ translationKey: "invalidPublicBatchId" });
      return;
    }

    let cancelled = false;
    setPublicBatch(null);
    setPublicBatchLoading(true);
    setPublicBatchError("");
    apiRequest(`/batches/public/${encodeURIComponent(publicBatchId)}`)
      .then(result => { if (!cancelled) setPublicBatch(result.batch); })
      .catch(error => { if (!cancelled) setPublicBatchError(error); })
      .finally(() => { if (!cancelled) setPublicBatchLoading(false); });
    return () => { cancelled = true; };
  }, [isPublicLookup, publicBatchId, publicBatchRetry]);

  function updateForm(event) {
    setForm(prev => ({ ...prev, [event.target.name]: event.target.value }));
  }

  function changeLanguage(language) {
    i18n.changeLanguage(language);
    try {
      localStorage.setItem("fm_language", language);
    } catch (error) {
      console.error("Could not save language preference.", error);
    }
    setForm(prev => ({ ...prev, preferredLanguage: language }));
    setUser(prev => {
      if (!prev) return prev;
      const updatedUser = { ...prev, preferredLanguage: language };
      try {
        localStorage.setItem("fm_user", JSON.stringify(updatedUser));
      } catch (error) {
        console.error("Could not save language preference to the local profile.", error);
      }
      return updatedUser;
    });
  }

  function openAuth(nextMode, nextRole = role) {
    setMode(nextMode);
    setRole(nextRole);
    setMessage("");
    setPage("auth");
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body = { ...form, role };
      if (mode === "login") delete body.name;
      const result = await apiRequest(`/auth/${mode}`, { method: "POST", body });
      localStorage.setItem("fm_token", result.token);
      localStorage.setItem("fm_user", JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
      const savedLanguage = localStorage.getItem("fm_language");
      i18n.changeLanguage(savedLanguage || result.user.preferredLanguage || form.preferredLanguage || "en");
      setPage("dashboard");
    } catch (error) {
      setMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function refreshWorkflow(isCurrent = () => true) {
    setWorkflowLoading(true);
    setWorkflowError("");
    try {
      const requests = [apiRequest("/interests/mine", { token })];
      if (user?.role === "trader") requests.push(apiRequest("/batches/marketplace", { token }));
      const [interestResult, marketplaceResult] = await Promise.all(requests);
      if (!isCurrent()) return;
      setPurchaseInterests(interestResult.interests || []);
      setMarketplaceBatches(marketplaceResult?.batches || []);
    } catch (error) {
      if (isCurrent()) setWorkflowError(error);
    } finally {
      if (isCurrent()) setWorkflowLoading(false);
    }
  }

  async function refreshWarehouseFacilities(isCurrent = () => true) {
    setWarehouseLoading(true);
    setWarehouseError("");
    try {
      const result = await apiRequest("/warehouses/facilities", { token });
      if (!isCurrent()) return;
      const facilities = result.facilities || [];
      setWarehouseFacilities(facilities);
      setSelectedFacilityId(current => facilities.some(facility => facility.id === current) ? current : facilities[0]?.id || "");
    } catch (error) {
      if (isCurrent()) setWarehouseError(error);
    } finally {
      if (isCurrent()) setWarehouseLoading(false);
    }
  }

  async function refreshWarehouseInventory(isCurrent = () => true) {
    if (!selectedFacilityId) {
      setWarehouseInventory([]);
      setOldestStoredInventory([]);
      return;
    }
    setWarehouseLoading(true);
    setWarehouseError("");
    try {
      const params = new URLSearchParams();
      if (inventorySearch.trim()) params.set("search", inventorySearch.trim());
      if (inventoryStatusFilter) params.set("status", inventoryStatusFilter);
      if (inventoryCropFilter) params.set("crop", inventoryCropFilter);
      const result = await apiRequest(`/warehouses/facilities/${encodeURIComponent(selectedFacilityId)}/inventory?${params}`, { token });
      if (!isCurrent()) return;
      setWarehouseFacilities(prev => prev.map(facility => facility.id === result.facility.id ? result.facility : facility));
      setWarehouseInventory(result.inventory || []);
      setOldestStoredInventory(result.oldestStored || []);
    } catch (error) {
      if (isCurrent()) setWarehouseError(error);
    } finally {
      if (isCurrent()) setWarehouseLoading(false);
    }
  }

  async function refreshDeliveries(isCurrent = () => true) {
    setDeliveryLoading(true);
    setDeliveryError("");
    try {
      const requests = [apiRequest("/deliveries/mine", { token })];
      if (user?.role === "transporter") requests.push(apiRequest("/deliveries/requests", { token }));
      const [mine, sharedRequests] = await Promise.all(requests);
      if (!isCurrent()) return;
      setDeliveries(mine.deliveries || []);
      setDeliveryRequests(sharedRequests?.requests || []);
      setDeliveryShares(mine.shares || []);
    } catch (error) {
      if (isCurrent()) setDeliveryError(error);
    } finally {
      if (isCurrent()) setDeliveryLoading(false);
    }
  }

  async function refreshRiskDashboard(isCurrent = () => true) {
    setRiskLoading(true);
    setRiskError("");
    try {
      const result = await apiRequest("/alerts", { token });
      if (!isCurrent()) return;
      setRiskData({ risks: result.risks || [], alerts: result.alerts || [] });
    } catch (error) {
      if (isCurrent()) setRiskError(error);
    } finally {
      if (isCurrent()) setRiskLoading(false);
    }
  }

  async function acknowledgeRiskAlert(alertKey) {
    setRiskBusyKey(alertKey);
    setRiskError("");
    try {
      const result = await apiRequest(`/alerts/${encodeURIComponent(alertKey)}/acknowledge`, {
        method: "POST",
        token
      });
      setRiskData(prev => ({
        ...prev,
        alerts: prev.alerts.map(alert => alert.key === alertKey
          ? { ...alert, acknowledgedAt: result.alert?.acknowledgedAt || result.acknowledgedAt || new Date().toISOString() }
          : alert)
      }));
    } catch (error) {
      setRiskError(error);
      await refreshRiskDashboard();
    } finally {
      setRiskBusyKey("");
    }
  }

  useEffect(() => {
    if (page !== "dashboard" || !user || user.role !== "farmer" || !token) return;
    let cancelled = false;
    setBatchLoading(true);
    apiRequest("/batches", { token })
      .then(result => { if (!cancelled) setBatches(result.batches || []); })
      .catch(error => { if (!cancelled) setBatchMessage(error); })
      .finally(() => { if (!cancelled) setBatchLoading(false); });
    return () => { cancelled = true; };
  }, [page, user, token]);

  useEffect(() => {
    if (page !== "dashboard" || !user || !token) return;
    let cancelled = false;
    refreshRiskDashboard(() => !cancelled);
    return () => { cancelled = true; };
  }, [page, user, token]);

  useEffect(() => {
    if (page !== "dashboard" || user?.role !== "warehouse" || !token) return;
    let cancelled = false;
    refreshWarehouseFacilities(() => !cancelled);
    return () => { cancelled = true; };
  }, [page, user, token]);

  useEffect(() => {
    if (page !== "dashboard" || user?.role !== "warehouse" || !token || !selectedFacilityId) return;
    let cancelled = false;
    const timer = setTimeout(() => refreshWarehouseInventory(() => !cancelled), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, user, token, selectedFacilityId, inventorySearch, inventoryStatusFilter, inventoryCropFilter]);

  useEffect(() => {
    if (page !== "dashboard" || !user || !["farmer", "trader"].includes(user.role) || !token) return;
    let cancelled = false;
    refreshWorkflow(() => !cancelled);
    return () => { cancelled = true; };
  }, [page, user, token]);

  useEffect(() => {
    if (page !== "dashboard" || !user || !["farmer", "trader", "transporter"].includes(user.role) || !token) return;
    let cancelled = false;
    refreshDeliveries(() => !cancelled);
    return () => { cancelled = true; };
  }, [page, user, token]);

  useEffect(() => {
    if (page !== "dashboard" || !user || user.role !== "farmer" || !token) return;
    let cancelled = false;
    setMarketLoading(true);
    setMarketError("");
    setMarketDiagnostics(null);
    if (!marketFilters.commodity) {
      setMarketOptions([]);
      setOfferCosts([]);
      setMarketHasMore(false);
      setMarketTotal(0);
      setMarketLoading(false);
      return () => { cancelled = true; };
    }
    if (marketOffset === 0) {
      setMarketOptions([]);
      setOfferCosts([]);
    }
    const params = new URLSearchParams({
      commodity: marketFilters.commodity,
      limit: "50",
      offset: String(marketOffset)
    });
    for (const [key, value] of Object.entries(marketFilters)) {
      if (value) params.set(key, value);
    }
    apiRequest(`/market/mandi-prices?${params}`, { token })
      .then(result => {
        if (cancelled) return;
        const records = Array.isArray(result.records) ? result.records : [];
        setMarketDiagnostics(result.diagnostics || null);
        setMarketOptions(prev => marketOffset === 0 ? records : [...prev, ...records]);
        setOfferCosts(prev => {
          const freshCosts = records.map(() => ({ transportCost: "", handlingCost: "", otherCosts: "", marketDistanceKm: "" }));
          return marketOffset === 0 ? freshCosts : [...prev, ...freshCosts];
        });
        setMarketTotal(result.total || records.length);
        setMarketHasMore(Boolean(result.hasMore));
        if (marketOffset === 0) setBatchForm(prev => ({ ...prev, marketIndex: "0" }));
      })
      .catch(error => {
        if (cancelled) return;
        setMarketHasMore(false);
        setMarketError(error);
      })
      .finally(() => { if (!cancelled) setMarketLoading(false); });
    return () => { cancelled = true; };
  }, [page, user, token, batchForm.cropName, marketSearchNonce, marketOffset]);

  useEffect(() => {
    if (page !== "dashboard" || user?.role !== "farmer" || !token) return;
    let cancelled = false;
    setLocationsLoading(true);
    setLocationsError("");
    apiRequest("/market/locations", { token })
      .then(result => {
        if (!cancelled) {
          setMarketLocations({
            states: Array.isArray(result.states) ? result.states : [],
            locations: Array.isArray(result.locations) ? result.locations : [],
            commodities: Array.isArray(result.commodities) ? result.commodities : [],
          });
        }
      })
      .catch(error => {
        if (!cancelled) setLocationsError(error);
      })
      .finally(() => { if (!cancelled) setLocationsLoading(false); });
    return () => { cancelled = true; };
  }, [page, user, token, locationsRetry]);

  function updateBatchForm(event) {
    setBatchForm(prev => ({ ...prev, [event.target.name]: event.target.value }));
    if (event.target.name === "cropName") {
      setMarketOffset(0);
      setMarketOptions([]);
      setOfferCosts([]);
      setMarketFilters(prev => ({ ...prev, commodity: "", state: "", district: "", market: "" }));
      setLocationsError("");
    }
  }

  function updateMarketFilter(event) {
    const { name, value } = event.target;
    setMarketFilters(prev => updateMandiLocationFilters(prev, name, value));
  }

  function searchMandiPrices(event) {
    event.preventDefault();
    const validState = !marketFilters.state || marketLocations.states.some(option => option === marketFilters.state);
    const validCommodity = marketLocations.commodities.some(option => option === marketFilters.commodity);
    const validDistrict = !marketFilters.district || marketLocations.locations.some(location =>
      location.state === marketFilters.state &&
      location.district === marketFilters.district
    );
    const validMarket = !marketFilters.market || marketLocations.locations.some(location =>
      location.state === marketFilters.state &&
      location.district === marketFilters.district &&
      location.market === marketFilters.market
    );
    if (!validCommodity || !validState || !validDistrict || !validMarket) {
      setLocationsError({ translationKey: !validCommodity ? "mandiChooseValidCommodity" : !validState ? "mandiChooseValidState" : !validDistrict ? "mandiChooseValidDistrict" : "mandiChooseValidMarket" });
      return;
    }
    setLocationsError("");
    setMarketOffset(0);
    setMarketSearchNonce(value => value + 1);
  }

  async function checkMandiApiStatus() {
    setMarketStatusLoading(true);
    try {
      const result = await apiRequest("/market/status", { token });
      setMarketStatus(result);
    } catch (error) {
      setMarketStatus({ reachable: false, code: error.code || "MARKET_API_NETWORK_ERROR" });
    } finally {
      setMarketStatusLoading(false);
    }
  }

  const districtOptions = getMandiDistrictOptions(marketLocations.locations, marketFilters.state);
  const marketNameOptions = getMandiMarketOptions(marketLocations.locations, marketFilters.state, marketFilters.district);
  const validSelectedState = isMandiOptionSelected(marketLocations.states, marketFilters.state);
  const validSelectedDistrict = isMandiOptionSelected(districtOptions, marketFilters.district);

  function updateOfferCost(index, name, value) {
    setOfferCosts(prev => prev.map((cost, costIndex) => (
      costIndex === index ? { ...cost, [name]: value } : cost
    )));
  }

  async function createBatch(event) {
    event.preventDefault();
    const selectedIndex = Number(batchForm.marketIndex);
    const selectedMarket = marketOptions[selectedIndex]?.priceUnitVerified ? marketOptions[selectedIndex] : null;
    const selectedCosts = offerCosts[selectedIndex];
    const quantity = Number(batchForm.quantityKg);
    const validCosts = Boolean(selectedCosts) &&
      selectedCosts.transportCost !== "" && selectedCosts.handlingCost !== "" && selectedCosts.otherCosts !== "" &&
      [selectedCosts.transportCost, selectedCosts.handlingCost, selectedCosts.otherCosts].every(value => {
        const amount = Number(value);
        return Number.isFinite(amount) && amount >= 0 && amount <= 1000000000;
      }) &&
      (selectedCosts.marketDistanceKm === "" || (
        Number.isFinite(Number(selectedCosts.marketDistanceKm)) &&
        Number(selectedCosts.marketDistanceKm) >= 0 &&
        Number(selectedCosts.marketDistanceKm) <= 10000000
      ));
    if (!Number.isFinite(quantity) || quantity < 0.01 || quantity > 100000000) {
      setBatchMessage({ translationKey: "invalidBatchQuantity" });
      return;
    }
    if (selectedMarket && (!validCosts || !selectedCosts)) {
      setBatchMessage({ translationKey: "invalidOfferCosts" });
      return;
    }
    setBatchBusy(true);
    setBatchMessage("");
    try {
      const result = await apiRequest("/batches", {
        method: "POST", token,
        body: {
          ...batchForm,
          quantityKg: quantity,
          ...(selectedMarket ? {
            mandiRecord: selectedMarket,
            transportCost: Number(selectedCosts.transportCost),
            handlingCost: Number(selectedCosts.handlingCost),
            otherCosts: Number(selectedCosts.otherCosts),
            marketDistanceKm: selectedCosts.marketDistanceKm === "" ? null : Number(selectedCosts.marketDistanceKm)
          } : {})
        }
      });
      setBatches(prev => [result.batch, ...prev]);
      setBatchMessage({ translationKey: selectedMarket ? "marketVerifyNotice" : "batchCreatedWithoutMarketPrice" });
      await refreshRiskDashboard();
    } catch (error) {
      setBatchMessage(error);
    } finally {
      setBatchBusy(false);
    }
  }

  async function publishBatch(batchId) {
    setWorkflowBusyId(batchId);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const result = await apiRequest(`/batches/${encodeURIComponent(batchId)}/publish`, { method: "PATCH", token });
      setBatches(prev => prev.map(batch => batch.batchId === batchId ? result.batch : batch));
      setWorkflowMessage({ noticeCode: result.noticeCode });
    } catch (error) {
      setWorkflowError(error);
    } finally {
      setWorkflowBusyId("");
    }
  }

  async function toggleWarehouseStorageAuthorization(batch) {
    const authorized = !batch.warehouseStorageAuthorized;
    setWorkflowBusyId(batch.batchId);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const result = await apiRequest(`/batches/${encodeURIComponent(batch.batchId)}/warehouse-authorization`, {
        method: "PATCH",
        token,
        body: { authorized }
      });
      setBatches(prev => prev.map(item => item.batchId === batch.batchId ? result.batch : item));
      setWorkflowMessage({ noticeCode: result.noticeCode });
    } catch (error) {
      setWorkflowError(error);
    } finally {
      setWorkflowBusyId("");
    }
  }

  async function submitPurchaseInterest(batchId) {
    setWorkflowBusyId(batchId);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const result = await apiRequest(`/interests/${encodeURIComponent(batchId)}`, { method: "POST", token });
      setPurchaseInterests(prev => [result.interest, ...prev]);
      setMarketplaceBatches(prev => prev.map(batch => batch.batchId === batchId ? { ...batch, status: "Buyer interested" } : batch));
      setWorkflowMessage({ noticeCode: result.noticeCode });
    } catch (error) {
      setWorkflowError(error);
    } finally {
      setWorkflowBusyId("");
    }
  }

  async function respondToInterest(interestId, decision) {
    setWorkflowBusyId(interestId);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const result = await apiRequest(`/interests/${encodeURIComponent(interestId)}/respond`, {
        method: "PATCH", token, body: { decision }
      });
      setPurchaseInterests(prev => prev.map(interest => (
        interest.id === interestId
          ? { ...interest, status: result.interest.status }
          : decision === "Accepted" && interest.batchId === result.interest.batchId && interest.status === "Pending"
            ? { ...interest, status: "Rejected" }
            : interest
      )));
      setWorkflowMessage({ noticeCode: result.noticeCode });
      if (user?.role === "farmer") {
        const [batchResult] = await Promise.all([
          apiRequest("/batches", { token }),
          refreshRiskDashboard()
        ]);
        setBatches(batchResult.batches || []);
      }
    } catch (error) {
      setWorkflowError(error);
    } finally {
      setWorkflowBusyId("");
    }
  }

  async function createStorageFacility(event) {
    event.preventDefault();
    const supportedCropTypes = facilityForm.supportedCropTypes.split(",").map(crop => crop.trim()).filter(Boolean);
    setWarehouseBusy(true);
    setWarehouseError("");
    setWarehouseMessage("");
    try {
      const result = await apiRequest("/warehouses/facilities", {
        method: "POST",
        token,
        body: { ...facilityForm, capacityKg: Number(facilityForm.capacityKg), supportedCropTypes }
      });
      setWarehouseFacilities(prev => [result.facility, ...prev]);
      setSelectedFacilityId(result.facility.id);
      setFacilityForm({ name: "", location: "", capacityKg: "", supportedCropTypes: "" });
      setWarehouseMessage({ noticeCode: result.noticeCode });
    } catch (error) {
      setWarehouseError(error);
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function recordIncomingBatch(event) {
    event.preventDefault();
    if (!selectedFacilityId) return;
    setWarehouseBusy(true);
    setWarehouseError("");
    setWarehouseMessage("");
    try {
      const result = await apiRequest(`/warehouses/facilities/${encodeURIComponent(selectedFacilityId)}/inventory`, {
        method: "POST",
        token,
        body: { ...incomingForm, quantityKg: Number(incomingForm.quantityKg) }
      });
      setWarehouseMessage({ noticeCode: result.noticeCode });
      setIncomingForm(prev => ({ ...prev, batchId: "", quantityKg: "" }));
      await refreshWarehouseInventory();
      await refreshRiskDashboard();
    } catch (error) {
      setWarehouseError(error);
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function changeInventoryStatus(inventoryId, status) {
    setWarehouseBusy(true);
    setWarehouseError("");
    setWarehouseMessage("");
    try {
      const result = await apiRequest(`/warehouses/facilities/${encodeURIComponent(selectedFacilityId)}/inventory/${encodeURIComponent(inventoryId)}/status`, {
        method: "PATCH", token, body: { status }
      });
      setWarehouseInventory(prev => prev.map(item => item.id === inventoryId ? result.inventory : item));
      setWarehouseMessage({ noticeCode: result.noticeCode });
      await refreshRiskDashboard();
    } catch (error) {
      setWarehouseError(error);
      await refreshWarehouseInventory();
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function dispatchInventory(inventoryId) {
    const quantityKg = Number(outgoingQuantities[inventoryId]);
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) {
      setWarehouseError({ translationKey: "outgoingQuantityInvalid" });
      return;
    }
    setWarehouseBusy(true);
    setWarehouseError("");
    setWarehouseMessage("");
    try {
      const result = await apiRequest(`/warehouses/facilities/${encodeURIComponent(selectedFacilityId)}/inventory/${encodeURIComponent(inventoryId)}/outgoing`, {
        method: "POST", token, body: { quantityKg }
      });
      setWarehouseMessage({ noticeCode: result.noticeCode });
      setOutgoingQuantities(prev => ({ ...prev, [inventoryId]: "" }));
      await refreshWarehouseInventory();
      await refreshRiskDashboard();
    } catch (error) {
      setWarehouseError(error);
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function submitDeliveryRequest(event) {
    event.preventDefault();
    setDeliveryBusyId("request-form");
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const result = await apiRequest("/deliveries/requests", {
        method: "POST",
        token,
        body: { ...deliveryForm, quantityKg: Number(deliveryForm.quantityKg), estimatedTransportCost: Number(deliveryForm.estimatedTransportCost) }
      });
      setDeliveryMessage({ noticeCode: result.noticeCode });
      setDeliveryForm(prev => ({ ...prev, batchId: "", transporterEmail: "", pickupLocation: "", destination: "", quantityKg: "", estimatedTransportCost: "" }));
      await refreshDeliveries();
      await refreshRiskDashboard();
    } catch (error) {
      setDeliveryError(error);
    } finally {
      setDeliveryBusyId("");
    }
  }

  async function createDeliveryRecord(event) {
    event.preventDefault();
    setDeliveryBusyId("request-form");
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const result = await apiRequest("/deliveries", {
        method: "POST",
        token,
        body: {
          ...deliveryForm,
          quantityKg: Number(deliveryForm.quantityKg),
          estimatedTransportCost: Number(deliveryForm.estimatedTransportCost)
        }
      });
      setDeliveryMessage({ noticeCode: result.noticeCode });
      setDeliveryForm(prev => ({ ...prev, batchId: "", pickupLocation: "", destination: "", quantityKg: "", estimatedTransportCost: "" }));
      await refreshDeliveries();
      await refreshRiskDashboard();
    } catch (error) {
      setDeliveryError(error);
    } finally {
      setDeliveryBusyId("");
    }
  }

  async function respondToDeliveryRequest(requestId, decision) {
    setDeliveryBusyId(requestId);
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const result = await apiRequest(`/deliveries/requests/${encodeURIComponent(requestId)}/respond`, {
        method: "POST", token, body: { decision }
      });
      setDeliveryMessage({ noticeCode: result.noticeCode });
      await refreshDeliveries();
      await refreshRiskDashboard();
    } catch (error) {
      setDeliveryError(error);
    } finally {
      setDeliveryBusyId("");
    }
  }

  async function updateDeliveryStatus(deliveryId, status) {
    setDeliveryBusyId(deliveryId);
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const result = await apiRequest(`/deliveries/${encodeURIComponent(deliveryId)}/status`, {
        method: "PATCH", token, body: { status }
      });
      setDeliveries(prev => prev.map(delivery => delivery.id === deliveryId ? result.delivery : delivery));
      setDeliveryMessage({ noticeCode: result.noticeCode });
      await refreshRiskDashboard();
    } catch (error) {
      setDeliveryError(error);
      await refreshDeliveries();
    } finally {
      setDeliveryBusyId("");
    }
  }

  function logout() {
    localStorage.removeItem("fm_token");
    localStorage.removeItem("fm_user");
    setToken("");
    setUser(null);
    setRiskData({ risks: [], alerts: [] });
    setPage("home");
  }

  const roleTitle = user ? t(user.role) : t(role);
  const RoleIcon = roles.find(item => item.id === (user?.role || role))?.icon || Sprout;
  const configuredPublicFrontendUrl = String(import.meta.env.VITE_PUBLIC_FRONTEND_URL || "").trim().replace(/\/+$/, "");
  const publicFrontendUrl = configuredPublicFrontendUrl || window.location.origin;
  const batchLookupUrl = batchId => `${publicFrontendUrl}/trace/${encodeURIComponent(batchId)}`;
  const comparisonQuantity = Number(batchForm.quantityKg);
  const validComparisonQuantity = Number.isFinite(comparisonQuantity) && comparisonQuantity >= 0.01 && comparisonQuantity <= 100000000;
  const comparisons = marketOptions.map((market, index) => {
    const costs = offerCosts[index];
    const transportCost = Number(costs?.transportCost);
    const handlingCost = Number(costs?.handlingCost);
    const otherCosts = Number(costs?.otherCosts);
    const validCosts = Boolean(costs) &&
      costs.transportCost !== "" && costs.handlingCost !== "" && costs.otherCosts !== "" &&
      [transportCost, handlingCost, otherCosts].every(amount =>
        Number.isFinite(amount) && amount >= 0 && amount <= 1000000000
      );
    const distanceValue = costs?.marketDistanceKm;
    const distanceKm = distanceValue === "" || distanceValue === undefined ? null : Number(distanceValue);
    const validDistance = distanceKm === null || (Number.isFinite(distanceKm) && distanceKm >= 0 && distanceKm <= 10000000);
    const price = Number(market.modalPricePerKg);
    const validPrice = Number.isFinite(price) && price > 0;
    const ready = validComparisonQuantity && validCosts && validPrice;
    const gross = ready ? Math.round((comparisonQuantity * price + Number.EPSILON) * 100) / 100 : null;
    const net = ready ? Math.round((gross - transportCost - handlingCost - otherCosts + Number.EPSILON) * 100) / 100 : null;
    return { market, index, transportCost, handlingCost, otherCosts, distanceKm, validDistance, gross, net, ready };
  });
  const comparisonReady = comparisons.some(option => option.ready);
  const readyComparisons = comparisons.filter(option => option.ready);
  const bestNet = comparisonReady ? Math.max(...readyComparisons.map(option => option.net)) : null;
  const sortedComparisons = [...comparisons].sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.ready ? b.net - a.net : 0;
  });
  const pendingDeliveryCount = deliveryRequests.length + deliveries.filter(delivery => delivery.status === "Requested").length;
  const activeDeliveryCount = deliveries.filter(delivery => ["Accepted", "In Transit"].includes(delivery.status)).length;
  const completedDeliveryCount = deliveries.filter(delivery => delivery.status === "Delivered").length;

  function updateDeliveryForm(field, value) {
    setDeliveryForm(prev => ({ ...prev, [field]: value }));
  }

  return (
    <div
      className="app-shell"
      onInvalidCapture={event => {
        const control = event.target;
        if (typeof control.setCustomValidity === "function") {
          control.setCustomValidity(validationMessageFor(control));
        }
      }}
      onInputCapture={event => {
        if (typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
      }}
    >
      <header className="topbar">
        <button className="brand" onClick={() => setPage(user ? "dashboard" : "home")} aria-label={t("brand")}>
          <span className="brand-mark"><Leaf size={22} /></span>
          <span>{t("brand")}</span>
        </button>
        <div className="top-actions">
          <Languages size={18} aria-hidden="true" />
          <select
            aria-label={t("language")}
            value={i18n.language}
            onChange={event => {
              changeLanguage(event.target.value);
            }}
          >
            {Object.entries(languageNames).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          {user && !isPublicLookup && <button className="logout-button" onClick={logout}><LogOut size={16} /> {t("logout")}</button>}
        </div>
      </header>

      {isPublicLookup && (
        <main className="public-lookup-layout">
          <section className="public-lookup-card">
            <span className="eyebrow">{tx("publicTraceability")}</span>
            <h1>{tx("batchLookup")}</h1>
            {publicBatchLoading && <p className="market-status" role="status">{tx("loadingBatch")}</p>}
            {publicBatchError && <div className="market-error" role="alert">{messageText(publicBatchError)} <button type="button" className="offer-select" onClick={() => setPublicBatchRetry(value => value + 1)}>{tx("mandiRetry")}</button></div>}
            {publicBatch && (
              <>
                <div className="public-batch-id">{tx("publicId")} {publicBatch.traceabilityId || publicBatch.batchId}</div>
                <dl className="public-batch-fields">
                  <div><dt>{tx("crop")}</dt><dd>{publicBatch.cropName || tx("notRecorded")}</dd></div>
                  <div><dt>{tx("variety")}</dt><dd>{publicBatch.variety || tx("notRecorded")}</dd></div>
                  <div><dt>{tx("originLocation")}</dt><dd>{publicBatch.originLocation || tx("notRecorded")}</dd></div>
                  <div><dt>{tx("batchId")}</dt><dd>{publicBatch.batchId || tx("notRecorded")}</dd></div>
                  <div><dt>{tx("recordedQuantity")}</dt><dd>{Number.isFinite(publicBatch.quantityKg) ? `${Number(publicBatch.quantityKg).toLocaleString()} ${publicBatch.quantityUnit || "kg"}` : tx("notRecorded")}</dd></div>
                  <div><dt>{tx("registrationDate")}</dt><dd>{formatRecordedDate(publicBatch.registrationDate)}</dd></div>
                  <div><dt>{tx("harvestDate")}</dt><dd>{formatRecordedDate(publicBatch.harvestDate)}</dd></div>
                  <div><dt>{tx("latestStatus")}</dt><dd>{publicBatch.latestStatus || tx("notRecorded")}</dd></div>
                  <div><dt>{tx("statusLastRecorded")}</dt><dd>{formatRecordedDate(publicBatch.latestStatusRecordedAt)}</dd></div>
                </dl>
                <section className="traceability-timeline">
                  <div className="batch-list-heading"><div><h2>{tx("timeline")}</h2><p>{tx("timelineIntro")}</p></div></div>
                  {publicBatch.milestones?.length ? <ol>{publicBatch.milestones.map((milestone, index) => (
                    <li key={`${milestone.type}-${milestone.recordedAt || "undated"}-${index}`}>
                      <div><strong>{localizeMilestoneLabel(milestone.label)}</strong><time>{tx(milestone.isEstimate ? "estimated" : "recorded")} {formatRecordedDate(milestone.recordedAt)}</time></div>
                      {milestone.storageType && <span>{tx("recordedStorageType")}: {tx(milestone.storageType)}</span>}
                      {Number.isFinite(milestone.storedQuantityKg) && <span>{tx("remainingStorageQuantity", { quantity: Number(milestone.storedQuantityKg).toLocaleString(i18n.resolvedLanguage) })}</span>}
                      {milestone.storageDate && <span>{tx("storageDateLabel")}: {formatRecordedDate(milestone.storageDate)}</span>}
                      {milestone.expectedDeliveryDate && <span>{tx("expectedDeliveryDateLabel")}: {formatRecordedDate(milestone.expectedDeliveryDate)}</span>}
                      {milestone.destination && <span>{tx("deliveryDestination")}: {milestone.destination}</span>}
                      {Number.isFinite(milestone.quantityKg) && <span>{tx("recordedQuantity")}: {Number(milestone.quantityKg).toLocaleString(i18n.resolvedLanguage)} kg</span>}
                      {milestone.explanations?.length > 0 && <ul>{milestone.explanations.map(explanation => <li key={explanation}>{localizeRiskText(explanation)}</li>)}</ul>}
                    </li>
                  ))}</ol> : <p className="empty-batches">{tx("noMilestones")}</p>}
                </section>
                <p className="traceability-recorded-note">{tx("publicRecordNote")}</p>
              </>
            )}
            <p className="traceability-disclaimer">{tx("traceabilityNote")}</p>
            {publicBatch && <button className="secondary-button lookup-home-link traceability-print-button" type="button" onClick={() => window.print()}>{tx("printRecord")}</button>}
            <a className="secondary-button lookup-home-link" href="/">{tx("returnHome")}</a>
          </section>
        </main>
      )}

      {!isPublicLookup && page === "home" && (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> {tx("farmToMarketIntelligence")}</div>
              <h1>{t("welcome")}</h1>
              <p className="hero-subtitle">{t("intro")}</p>
              <div className="hero-buttons">
                <button className="primary-button" onClick={() => openAuth("signup", "farmer")}>{t("getStarted")} <ArrowRight size={18} /></button>
                <button className="secondary-button" onClick={() => openAuth("login", "farmer")}>{t("signIn")}</button>
              </div>
              <div className="trust-line"><ShieldCheck size={16} /> {t("secureNote")}</div>
            </div>
            <div className="hero-art" role="img" aria-label={tx("farmIllustration")}>
              <div className="sun" />
              <div className="field field-back" />
              <div className="field field-mid" />
              <div className="field field-front" />
              <div className="art-card art-card-one"><TrendingUp size={17} /><span>{tx("marketInsights")}</span><strong>{tx("compareReturns")}</strong></div>
              <div className="art-card art-card-two"><PackageCheck size={17} /><span>{tx("traceableBatches")}</span><strong>{tx("farmToBuyer")}</strong></div>
            </div>
          </section>

          <section className="role-section">
            <div className="section-heading">
              <div><span className="eyebrow">{tx("onePlatform")}</span><h2>{t("chooseRole")}</h2></div>
              <p>{tx("chooseRolePrompt")}</p>
            </div>
            <div className="role-grid">
              {roles.map(item => {
                const Icon = item.icon;
                return <article className="role-card" key={item.id}>
                  <div className={`role-icon ${item.color}`}><Icon size={23} /></div>
                  <h3>{t(item.id)}</h3>
                  <p>{tx(`${item.id}Intro`)}</p>
                  <div className="role-actions">
                    <button onClick={() => openAuth("signup", item.id)}>{t("signup")}</button>
                    <button onClick={() => openAuth("login", item.id)}>{t("login")}</button>
                  </div>
                </article>;
              })}
            </div>
          </section>
          <footer className="footer">Farm2Market AI <span>•</span> {t("tagline")}</footer>
        </main>
      )}

      {!isPublicLookup && page === "auth" && (
        <main className="auth-layout">
          <section className="auth-side">
            <div className={`role-icon large ${roles.find(item => item.id === role)?.color || "green"}`}><RoleIcon size={28} /></div>
            <span className="eyebrow">FARM2MARKET AI</span>
            <h1>{mode === "signup" ? t("createAccount") : t("signIn")}</h1>
            <p>{tx("continueAs")} <strong>{t(role)}</strong>. {tx("rolePermissions")}</p>
            <div className="auth-role-list">
              {roles.map(item => <button className={role === item.id ? "selected" : ""} key={item.id} onClick={() => setRole(item.id)}>
                <span>{t(item.id)}</span><ArrowRight size={16} />
              </button>)}
            </div>
          </section>
          <section className="auth-card">
            <button className="back-link" onClick={() => setPage("home")}>{tx("backHome")}</button>
            <h2>{mode === "signup" ? t("createAccount") : t("login")}</h2>
            <p className="muted">{mode === "signup" ? tx("signupIntro") : tx("loginIntro")}</p>
            <form onSubmit={submitAuth} aria-describedby={message ? "auth-form-message" : undefined}>
              {mode === "signup" && <label>{t("name")}<input name="name" value={form.name} onChange={updateForm} required minLength="2" maxLength="80" autoComplete="name" placeholder={tx("enterName")} /></label>}
              <label>{t("email")}<input type="email" name="email" value={form.email} onChange={updateForm} required autoComplete="email" placeholder={tx("emailExample")} /></label>
              <label>{t("password")}<input type="password" name="password" value={form.password} onChange={updateForm} required minLength="8" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={tx("passwordHint")} /></label>
              {mode === "signup" && <label>{t("language")}<select name="preferredLanguage" value={form.preferredLanguage} onChange={updateForm}>{Object.entries(languageNames).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
              <div className="selected-role"><RoleIcon size={17} /><span>{t("accountType")}: <strong>{t(role)}</strong></span></div>
              {message && <div id="auth-form-message" className="form-message" role="alert" aria-live="assertive">{messageText(message)}</div>}
              <button className="primary-button full-width" disabled={busy}>{busy ? t("loading") : mode === "signup" ? t("signup") : t("login")} <ArrowRight size={18} /></button>
            </form>
            <p className="switch-auth">{mode === "signup" ? t("existingAccountPrompt") : t("createAccountPrompt")} <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}>{mode === "signup" ? t("login") : t("signup")}</button></p>
          </section>
        </main>
      )}

      {!isPublicLookup && page === "dashboard" && user && (
        <main className="dashboard-layout">
          <section className="dashboard-welcome">
            <div className={`role-icon large ${roles.find(item => item.id === user.role)?.color || "green"}`}><RoleIcon size={28} /></div>
            <div><span className="eyebrow">{t("dashboard")}</span><h1>{t("accountReady")}</h1><p>{t("roleDescription")}</p></div>
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><span className="eyebrow">{tx("yourWorkspace")}</span><h2>{t(user.role)} {t("dashboard")}</h2></div><span className="status-pill"><span /> {tx("signedIn")}</span></div>
            <div className="profile-grid">
              <div><span>{t("name")}</span><strong>{user.name}</strong></div>
              <div><span>{t("email")}</span><strong>{user.email}</strong></div>
              <div><span>{t("accountType")}</span><strong>{roleTitle}</strong></div>
              <div><span>{t("language")}</span><strong>{languageNames[user.preferredLanguage] || languageNames[i18n.resolvedLanguage] || languageNames.en}</strong></div>
            </div>
            <SpoilageRiskPanel
              risks={riskData.risks}
              alerts={riskData.alerts}
              loading={riskLoading}
              error={riskError}
              busyKey={riskBusyKey}
              onRefresh={() => refreshRiskDashboard()}
              onAcknowledge={acknowledgeRiskAlert}
            />
            {user.role === "farmer" ? (
              <section className="farmer-workspace">
                <div className="workspace-heading"><div><span className="eyebrow">{tx("cropManagement")}</span><h2>{tx("registerBatch")}</h2><p>{tx("batchIntro")}</p></div><span className="demo-tag">{tx("mandiDataSource")}</span></div>
                <form id="batch-registration-form" className="batch-form" onSubmit={createBatch} aria-describedby={marketError ? "market-form-error" : batchMessage ? "batch-form-message" : undefined}>
                  <label>{tx("cropName")}<select name="cropName" value={batchForm.cropName} onChange={updateBatchForm}>{["Rice", "Paddy", "Tomato", "Onion", "Potato", "Maize", "Chilli", "Cotton"].map(crop => <option key={crop} value={crop}>{tx(crop)}</option>)}</select></label>
                  <label>{tx("quantityKg")}<input type="number" name="quantityKg" min="0.01" max="100000000" step="0.01" value={batchForm.quantityKg} onChange={updateBatchForm} required /></label>
                  <label>{tx("harvestDate")}<input type="date" name="harvestDate" value={batchForm.harvestDate} onChange={updateBatchForm} max={new Date().toISOString().slice(0, 10)} required /></label>
                  <label>{tx("farmLocation")}<input name="farmLocation" value={batchForm.farmLocation} onChange={updateBatchForm} minLength="2" maxLength="120" placeholder={tx("locationExample")} required /></label>
                </form>
                <div className="market-comparison">
                  <div className="market-comparison-heading">
                    <div><h3><TrendingUp size={17} /> {tx("mandiComparisonTitle")}</h3><p>{tx("mandiComparisonIntro")}</p></div>
                    <span className="demo-tag">{tx("mandiDataSource")}</span>
                  </div>
                  <form className="batch-form mandi-filter-form" onSubmit={searchMandiPrices}>
                    <label>{tx("mandiFilterCommodity")}<select name="commodity" value={marketFilters.commodity} onChange={updateMarketFilter} disabled={locationsLoading || marketLocations.commodities.length === 0}><option value="">{tx("mandiSelectCommodity")}</option>{marketLocations.commodities.map(commodity => <option key={commodity} value={commodity}>{commodity}</option>)}</select></label>
                    <label>{tx("mandiFilterState")}<select name="state" value={marketFilters.state} onChange={updateMarketFilter} disabled={locationsLoading || marketLocations.states.length === 0}><option value="">{tx("mandiSelectState")}</option>{marketLocations.states.map(state => <option key={state} value={state}>{state}</option>)}</select></label>
                    <label>{tx("mandiFilterDistrict")}<select name="district" value={marketFilters.district} onChange={updateMarketFilter} disabled={!validSelectedState}><option value="">{tx("mandiSelectDistrict")}</option>{districtOptions.map(district => <option key={district} value={district}>{district}</option>)}</select></label>
                    <label>{tx("mandiFilterMarket")}<select name="market" value={marketFilters.market} onChange={updateMarketFilter} disabled={!validSelectedDistrict}><option value="">{tx("mandiSelectMarket")}</option>{marketNameOptions.map(market => <option key={market} value={market}>{market}</option>)}</select></label>
                    <label>{tx("mandiFilterDate")}<input name="reportDate" type="date" value={marketFilters.reportDate} onChange={updateMarketFilter} max={new Date().toISOString().slice(0, 10)} /></label>
                    <button type="submit" className="offer-select" disabled={marketLoading || !marketFilters.commodity}>{marketLoading ? tx("loading") : tx("mandiSearch")}</button>
                  </form>
                  {locationsLoading && <p className="market-status" role="status">{tx("mandiLoadingLocations")}</p>}
                  {locationsError && <div className="market-error" role="alert">{messageText(locationsError)} <button type="button" className="offer-select" disabled={locationsLoading} onClick={() => setLocationsRetry(value => value + 1)}>{tx("mandiRetry")}</button></div>}
                  <p className="comparison-hint">{tx("mandiSourceUnitNote")}</p>
                  {marketLoading && <p className="market-status" role="status">{tx("loadingOffers")}</p>}
                  {marketError && <div id="market-form-error" className="market-error" role="alert" aria-live="assertive">{messageText(marketError)} <button type="button" className="offer-select" onClick={() => { setMarketOffset(0); setMarketSearchNonce(value => value + 1); }}>{tx("mandiRetry")}</button></div>}
                  {marketStatus && <p className={`market-status ${marketStatus.reachable ? "" : "market-error"}`} role="status">{marketStatus.reachable ? tx("mandiStatusAvailable", { status: marketStatus.httpStatus, count: marketStatus.recordCount }) : tx("mandiStatusUnavailable", { error: tx(marketStatusErrorKey(marketStatus.code)) })}</p>}
                  {!marketLoading && !marketError && (
                    <>
                      {marketOptions.length === 0
                        ? marketFilters.commodity
                          ? <>
                            <p className="empty-batches">{tx("mandiNoRecords")}</p>
                            <p className="comparison-hint">{tx("mandiNoRecordsDiagnostic", {
                              apiTotal: marketDiagnostics?.apiReportedTotal ?? marketTotal,
                              inspected: marketDiagnostics?.recordsInspected ?? 0
                            })}</p>
                            {marketDiagnostics?.filterMismatches?.map(({ field, requested, returned }) => (
                              <p className="comparison-hint" key={field}>{tx("mandiFilterMismatch", {
                                field,
                                requested,
                                returned: returned.join(", ")
                              })}</p>
                            ))}
                          </>
                          : <p className="empty-batches">{tx("mandiChooseValidCommodity")}</p>
                        : <p className="comparison-hint">{tx("originLabel")}: {batchForm.farmLocation.trim() || tx("enterLocation")}. {tx("mandiMarketEstimate")}</p>}
                      {marketOptions.length > 0 && <p className="market-option-meta">{tx("mandiPageInfo", { count: marketOptions.length, total: marketTotal })}</p>}
                      <div className="market-options-grid">
                        {sortedComparisons.map(({ market, index, transportCost, handlingCost, otherCosts, distanceKm, validDistance, gross, net, ready }) => {
                          const isBest = comparisons.length > 1 && comparisonReady && net === bestNet;
                          const isSelected = String(index) === batchForm.marketIndex;
                          const pricePerKg = market.priceUnitVerified ? Number(market.modalPricePerKg) : null;
                          return (
                            <article className={`market-option-card ${isSelected ? "chosen" : ""}`} key={market.id}>
                              <div className="market-option-top">
                                <strong>{market.market}</strong>
                                {isBest && <span className="best-option-badge">{comparisons.filter(option => option.net === bestNet).length > 1 ? tx("tiedBestNet") : tx("bestNet")}</span>}
                              </div>
                              <p className="market-option-meta">{market.commodity}{market.variety ? ` · ${market.variety}` : ""} · {market.district}, {market.state}</p>
                              <span className="market-price">{pricePerKg === null ? tx("mandiUnitUnverified") : `₹${pricePerKg.toFixed(2)}`} <small>{market.priceUnit ? `(${market.priceUnit})` : ""}{pricePerKg === null ? "" : ` / kg · ${tx("mandiModalPerKg")}`}</small></span>
                              <p className="market-option-meta">{tx("mandiMinReported")}: {market.reportedMinPrice === null ? "—" : market.reportedMinPrice} · {tx("mandiMaxReported")}: {market.reportedMaxPrice === null ? "—" : market.reportedMaxPrice}</p>
                              <p className="market-option-meta">{tx("mandiModalReported")}: {market.reportedModalPrice}</p>
                              <p className="market-option-meta">{tx("mandiReportedDate")}: {new Date(`${market.reportDate}T00:00:00`).toLocaleDateString(i18n.resolvedLanguage)}</p>
                              <p className="market-option-meta">{tx("mandiRetrievedAt")}: {new Date(market.retrievedAt).toLocaleString(i18n.resolvedLanguage)} · {market.dataSource || tx("mandiDataSource")}</p>
                              <label>{tx("distance")}
                                <input form="batch-registration-form" type="number" name={`marketDistanceKm-${index}`} min="0" max="10000000" step="0.1" value={offerCosts[index]?.marketDistanceKm ?? ""} onChange={event => updateOfferCost(index, "marketDistanceKm", event.target.value)} />
                              </label>
                              <label>{tx("transportCost")}
                                <input form="batch-registration-form" type="number" name={`transportCost-${index}`} min="0" max="1000000000" step="0.01" required={isSelected} value={offerCosts[index]?.transportCost ?? ""} onChange={event => updateOfferCost(index, "transportCost", event.target.value)} />
                              </label>
                              <label>{tx("handlingCost")}
                                <input form="batch-registration-form" type="number" name={`handlingCost-${index}`} min="0" max="1000000000" step="0.01" required={isSelected} value={offerCosts[index]?.handlingCost ?? ""} onChange={event => updateOfferCost(index, "handlingCost", event.target.value)} />
                              </label>
                              <label>{tx("otherCosts")}
                                <input form="batch-registration-form" type="number" name={`otherCosts-${index}`} min="0" max="1000000000" step="0.01" required={isSelected} value={offerCosts[index]?.otherCosts ?? ""} onChange={event => updateOfferCost(index, "otherCosts", event.target.value)} />
                              </label>
                              <div className="offer-calculations">
                                <span>{tx("gross")}: {ready ? `${comparisonQuantity.toLocaleString(i18n.resolvedLanguage)} kg × ₹${pricePerKg.toFixed(2)}/kg` : tx("quantityPriceUnavailable")}
                                  <strong>{ready ? `= ₹${gross.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</strong>
                                </span>
                                <span>{tx("lessTransport")} <strong>{ready ? `− ₹${transportCost.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 })}` : "—"}</strong></span>
                                <span>{tx("lessHandling")} <strong>{ready ? `− ₹${handlingCost.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 })}` : "—"}</strong></span>
                                <span>{tx("lessOther")} <strong>{ready ? `− ₹${otherCosts.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 })}` : "—"}</strong></span>
                                <span>{tx("estimatedNet")}<strong className={ready && net < 0 ? "net-negative" : ""}>{ready ? `₹${net.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 })}` : tx("enterQuantityCosts")}</strong></span>
                              </div>
                              <button type="button" className="offer-select" aria-pressed={isSelected} disabled={!market.priceUnitVerified} onClick={() => setBatchForm(prev => ({ ...prev, marketIndex: String(index) }))}>
                                {isSelected ? tx("selectedForBatch") : tx("mandiSelectRecord")}
                              </button>
                            </article>
                          );
                        })}
                      </div>
                      {comparisonReady && readyComparisons.length > 1 && <p className="best-return-message" role="status">{tx("bestReturn", { markets: readyComparisons.filter(option => option.net === bestNet).map(option => option.market.market).join(` ${tx("and")} `), amount: bestNet.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 }) })}</p>}
                      {!comparisonReady && <p className="comparison-hint" role="status">{tx("allCostsHint")}</p>}
                      {marketHasMore && <button type="button" className="offer-select" disabled={marketLoading} onClick={() => setMarketOffset(value => value + 50)}>{marketLoading ? tx("loading") : tx("mandiLoadMore")}</button>}
                    </>
                  )}
                </div>
                {batchMessage && <div id="batch-form-message" className="batch-message" role={batchMessage instanceof Error || batchMessage.translationKey !== "marketVerifyNotice" ? "alert" : "status"} aria-live={batchMessage instanceof Error || batchMessage.translationKey !== "marketVerifyNotice" ? "assertive" : "polite"}>{messageText(batchMessage)}</div>}
                <button form="batch-registration-form" type="submit" className="primary-button batch-submit" disabled={batchBusy || marketLoading}>
                  {batchBusy ? tx("savingBatch") : <><Plus size={17} /> {tx("createBatch")}</>}
                </button>
                <div className="batch-list-heading"><div><h3>{tx("yourBatches")}</h3><p>{tx("savedDatabase")}</p></div><button className="icon-button" type="button" onClick={() => { setBatchLoading(true); apiRequest("/batches", { token }).then(r => setBatches(r.batches || [])).catch(setBatchMessage).finally(() => setBatchLoading(false)); }} aria-label={tx("refreshBatches")}><RefreshCw size={16} /></button></div>
                {batchLoading ? <p className="empty-batches" role="status">{tx("loadingBatches")}</p> : batches.length === 0 ? <div className="empty-batches"><PackageCheck size={25} /><strong>{tx("noBatches")}</strong><span>{tx("firstBatch")}</span></div> : <div className="batch-grid">{batches.map(batch => {
                  const hasReportedMarketPrice = batch.estimateSource === "AGMARKNET_REPORTED" &&
                    batch.marketModalPricePerQuintal !== undefined && batch.marketReportedDate && batch.marketRetrievedAt;
                  const hasPriceEstimate = Boolean(hasReportedMarketPrice && Number(batch.estimatedPricePerKg) > 0);
                  return <article className="batch-card" key={batch.batchId}><div className="batch-card-top"><span className="batch-id">{batch.batchId}</span><span className="batch-status">{tx(batch.status)}</span></div><h3>{batch.cropName}</h3><p className="batch-location"><MapPin size={14} /> {batch.farmLocation}</p><div className="batch-facts"><span><strong>{Number(batch.quantityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong><small>{tx("quantityKg")}</small></span><span><strong>{hasPriceEstimate ? "₹" + Number(batch.estimatedPricePerKg).toFixed(2) + "/kg" : tx("priceUnavailableShort")}</strong><small>{hasPriceEstimate ? tx("mandiReportedPrice") : tx("priceNotRecorded")}</small></span><span><strong>{hasPriceEstimate ? "₹" + Number(batch.estimatedGross).toLocaleString(i18n.resolvedLanguage) : tx("priceUnavailableShort")}</strong><small>{tx("estimatedGross")}</small></span><span><strong className={batch.estimatedNet >= 0 ? "net-positive" : "net-negative"}>{hasPriceEstimate ? "₹" + Number(batch.estimatedNet).toLocaleString(i18n.resolvedLanguage) : tx("priceUnavailableShort")}</strong><small>{tx("estimatedNetLabel")}</small></span></div>{hasReportedMarketPrice ? <p className="market-option-meta">{tx("mandiSavedPriceNote", { quintal: Number(batch.marketModalPricePerQuintal).toFixed(2), kg: Number(batch.estimatedPricePerKg).toFixed(2), date: new Date(batch.marketReportedDate).toLocaleDateString(i18n.resolvedLanguage), market: batch.marketName, district: batch.marketDistrict, state: batch.marketState, retrievedAt: new Date(batch.marketRetrievedAt).toLocaleString(i18n.resolvedLanguage) })}</p> : <p className="batch-cost-note">{tx("priceNotRecorded")}</p>}<p className="batch-harvest"><CalendarDays size={14} /> {tx("harvestLabel")}: {new Date(batch.harvestDate).toLocaleDateString(i18n.resolvedLanguage)}</p><div className="batch-cost-note">{tx("batchCostNote", { transport: Number(batch.transportCost).toLocaleString(i18n.resolvedLanguage), handling: Number(batch.handlingCost).toLocaleString(i18n.resolvedLanguage), other: Number(batch.otherCosts || 0).toLocaleString(i18n.resolvedLanguage) })}</div>{batch.isPublished ? <p className="published-label">{tx("publishedToTraders")}</p> : <button type="button" className="offer-select publish-button" disabled={workflowBusyId === batch.batchId} onClick={() => publishBatch(batch.batchId)}>{workflowBusyId === batch.batchId ? tx("publishing") : tx("publishAvailable")}</button>}<div className="batch-qr"><QRCodeSVG id={`batch-qr-${batch.batchId}`} value={batchLookupUrl(batch.publicTraceabilityId || batch.batchId)} size={144} level="M" marginSize={2} title={tx("qrTitle", { batchId: batch.batchId })} /><div><strong>{tx("publicQr")}</strong><p>{tx("stablePublicId", { id: batch.publicTraceabilityId || batch.batchId })}</p><a href={batchLookupUrl(batch.publicTraceabilityId || batch.batchId)} target="_blank" rel="noreferrer">{tx("openTraceability")}</a><button type="button" className="offer-select qr-download-button" onClick={() => downloadBatchQr(batch.batchId)}>{tx("downloadQr")}</button></div></div></article>;
                })}</div>}
                <section className="delivery-section">
                  <div className="batch-list-heading"><div><h3>{tx("warehouseStorageTitle")}</h3><p>{tx("warehousePermissionIntro")}</p></div></div>
                  <WarehouseAuthorizationList batches={batches} busyId={workflowBusyId} onToggle={toggleWarehouseStorageAuthorization} />
                </section>
                {workflowError && <p className="workflow-error" role="alert">{messageText(workflowError)}</p>}
                {workflowMessage && <p className="workflow-message" role="status">{messageText(workflowMessage)}</p>}
                <div className="batch-list-heading"><div><h3>{tx("purchaseRequests")}</h3><p>{tx("farmerPurchaseIntro")}</p></div><span className="status-pill">{tx("pendingCount", { count: purchaseInterests.filter(interest => interest.status === "Pending").length })}</span><button className="icon-button" type="button" onClick={() => refreshWorkflow()} disabled={workflowLoading} aria-label={tx("refreshInterests")}><RefreshCw size={16} /></button></div>
                {workflowLoading ? <p className="market-status" role="status">{tx("loadingRequestsShort")}</p> : purchaseInterests.length === 0 ? <div className="empty-batches"><strong>{tx("noTraderRequestsShort")}</strong><span>{tx("publishAvailableHint")}</span></div> : <div className="interest-list">{purchaseInterests.map(interest => <article className="interest-card" key={interest.id}><div><strong>{interest.cropName} · {interest.batchId}</strong><span>{interest.traderName} · {Number(interest.quantityKg).toLocaleString(i18n.resolvedLanguage)} kg</span></div><span className={`interest-status ${interest.status.toLowerCase()}`}>{tx(interest.status)}</span>{interest.status === "Pending" && <div className="interest-actions"><button type="button" disabled={workflowBusyId === interest.id} onClick={() => respondToInterest(interest.id, "Accepted")}>{workflowBusyId === interest.id ? tx("saving") : tx("accept")}</button><button type="button" disabled={workflowBusyId === interest.id} onClick={() => respondToInterest(interest.id, "Rejected")}>{tx("reject")}</button></div>}</article>)}</div>}
                <section className="delivery-workspace">
                  <div className="batch-list-heading"><div><h3>{tx("requestTransporter")}</h3><p>{tx("sharePublishedBatch")}</p></div><button type="button" className="icon-button" onClick={() => refreshDeliveries()} disabled={deliveryLoading} aria-label={tx("refreshDelivery")}><RefreshCw size={16} /></button></div>
                  {deliveryError && <p id="delivery-request-error" className="workflow-error" role="alert" aria-live="assertive">{messageText(deliveryError)}</p>}
                  {deliveryMessage && <p className="workflow-message" role="status">{messageText(deliveryMessage)}</p>}
                  <p className="manual-eta-note">{tx("manualEta")}</p>
                  <DeliveryDetailsForm form={deliveryForm} onChange={updateDeliveryForm} onSubmit={submitDeliveryRequest} busy={deliveryBusyId === "request-form"} mode="request" error={deliveryError} />
                  <div className="batch-list-heading"><div><h3>{tx("deliveryShare")}</h3><p>{tx("deliveryShareHint")}</p></div><span className="status-pill">{tx("awaitingDecision", { count: deliveryShares.filter(share => share.status === "Requested").length })}</span></div>
                  <DeliveryShareCards shares={deliveryShares} loading={deliveryLoading} />
                  <div className="batch-list-heading"><div><h3>{tx("deliveryProgress")}</h3><p>{tx("deliveryProgressHint")}</p></div></div>
                  <DeliveryCards deliveries={deliveries} loading={deliveryLoading} />
                </section>
              </section>
            ) : user.role === "trader" ? (
              <section className="farmer-workspace">
                <div className="workspace-heading"><div><span className="eyebrow">{tx("farmerConnections")}</span><h2>{tx("marketplace")}</h2><p>{tx("browseBatches")}</p></div><div className="trader-workspace-actions"><span className="demo-tag">{tx("demoMarketEstimates")}</span><button className="icon-button" type="button" onClick={() => refreshWorkflow()} disabled={workflowLoading} aria-label={tx("refreshMarketplace")}><RefreshCw size={16} /></button></div></div>
                {workflowError && <p className="workflow-error" role="alert">{messageText(workflowError)}</p>}
                {workflowMessage && <p className="workflow-message" role="status">{messageText(workflowMessage)}</p>}
                {workflowLoading ? <p className="empty-batches" role="status">{tx("loadingPublishedBatches")}</p> : marketplaceBatches.length === 0 ? <div className="empty-batches"><PackageCheck size={25} /><strong>{tx("noPublishedBatches")}</strong><span>{tx("checkLater")}</span></div> : <div className="batch-grid">{marketplaceBatches.map(batch => {
                  const existingInterest = purchaseInterests.find(interest => interest.batchId === batch.batchId);
                  return <article className="batch-card" key={batch.batchId}><div className="batch-card-top"><span className="batch-id">{batch.batchId}</span><span className="batch-status">{tx(batch.status)}</span></div><h3>{batch.cropName}</h3><div className="batch-facts trader-batch-facts"><span><strong>{Number(batch.quantityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong><small>{tx("recordedQuantity")}</small></span><span><strong>{new Date(batch.harvestDate).toLocaleDateString(i18n.resolvedLanguage)}</strong><small>{tx("harvestDate")}</small></span></div>{batch.estimateSource === "DEMO_ESTIMATE" && <p className="batch-cost-note">{tx("illustrativeMarketData")}</p>}{existingInterest ? <p className="published-label">{tx("yourRequest", { status: tx(existingInterest.status) })}</p> : <button type="button" className="offer-select publish-button" disabled={workflowBusyId === batch.batchId} onClick={() => submitPurchaseInterest(batch.batchId)}>{workflowBusyId === batch.batchId ? tx("sending") : tx("interested")}</button>}</article>;
                })}</div>}
                <div className="batch-list-heading"><div><h3>{tx("yourPurchaseRequests")}</h3><p>{tx("trackFarmerDecisions")}</p></div><span className="status-pill">{tx("awaitingFarmerDecision", { count: purchaseInterests.filter(interest => interest.status === "Pending").length })}</span><button className="icon-button" type="button" onClick={() => refreshWorkflow()} disabled={workflowLoading} aria-label={tx("refreshInterests")}><RefreshCw size={16} /></button></div>
                {purchaseInterests.length === 0 ? <div className="empty-batches"><strong>{tx("noRequestsSubmitted")}</strong><span>{tx("submitInterestHint")}</span></div> : <div className="interest-list">{purchaseInterests.map(interest => <article className="interest-card" key={interest.batchId}><div><strong>{interest.cropName} · {interest.batchId}</strong><span>{interest.quantityKg == null ? tx("batchDetailsUnavailable") : `${Number(interest.quantityKg).toLocaleString(i18n.resolvedLanguage)} kg`}</span></div><span className={`interest-status ${interest.status.toLowerCase()}`}>{tx(interest.status)}</span></article>)}</div>}
                <section className="delivery-workspace">
                  <div className="batch-list-heading"><div><h3>{tx("acceptedPurchaseDelivery")}</h3><p>{tx("acceptedPurchaseHint")}</p></div><button type="button" className="icon-button" onClick={() => refreshDeliveries()} disabled={deliveryLoading} aria-label={tx("refreshDelivery")}><RefreshCw size={16} /></button></div>
                  {deliveryError && <p id="delivery-request-error" className="workflow-error" role="alert" aria-live="assertive">{messageText(deliveryError)}</p>}
                  {deliveryMessage && <p className="workflow-message" role="status">{messageText(deliveryMessage)}</p>}
                  <p className="manual-eta-note">{tx("manualEta")}</p>
                  <DeliveryDetailsForm form={deliveryForm} onChange={updateDeliveryForm} onSubmit={submitDeliveryRequest} busy={deliveryBusyId === "request-form"} mode="request" error={deliveryError} />
                  <div className="batch-list-heading"><div><h3>{tx("deliveryShare")}</h3><p>{tx("deliveryShareHint")}</p></div><span className="status-pill">{tx("awaitingDecision", { count: deliveryShares.filter(share => share.status === "Requested").length })}</span></div>
                  <DeliveryShareCards shares={deliveryShares} loading={deliveryLoading} />
                  <div className="batch-list-heading"><div><h3>{tx("deliveryProgress")}</h3><p>{tx("deliveryProgressHint")}</p></div></div>
                  <DeliveryCards deliveries={deliveries} loading={deliveryLoading} />
                </section>
              </section>
            ) : user.role === "warehouse" ? (
              <section className="farmer-workspace warehouse-workspace">
                <div className="workspace-heading"><div><span className="eyebrow">{tx("warehouseOperations")}</span><h2>{tx("storageInventory")}</h2><p>{tx("warehouseRegisterHint")}</p></div><button className="icon-button" type="button" onClick={() => refreshWarehouseFacilities()} disabled={warehouseLoading} aria-label={tx("refreshWarehouse")}><RefreshCw size={16} /></button></div>
                {warehouseError && <p id="warehouse-form-error" className="workflow-error" role="alert" aria-live="assertive">{messageText(warehouseError)}</p>}
                {warehouseMessage && <p className="workflow-message" role="status">{messageText(warehouseMessage)}</p>}
                <section className="facility-register">
                  <h3>{tx("registerFacility")}</h3>
                  <form className="batch-form facility-form" onSubmit={createStorageFacility} aria-describedby={warehouseError ? "warehouse-form-error" : undefined}>
                    <label>{tx("facilityName")}<input value={facilityForm.name} onChange={event => setFacilityForm(prev => ({ ...prev, name: event.target.value }))} minLength="2" maxLength="100" required placeholder={tx("facilityExample")} /></label>
                    <label>{tx("villageLocation")}<input value={facilityForm.location} onChange={event => setFacilityForm(prev => ({ ...prev, location: event.target.value }))} minLength="2" maxLength="120" required placeholder={tx("locationGuntur")} /></label>
                    <label>{tx("capacityKg")}<input type="number" min="1" max="1000000000" step="0.01" value={facilityForm.capacityKg} onChange={event => setFacilityForm(prev => ({ ...prev, capacityKg: event.target.value }))} required /></label>
                    <label>{tx("cropTypes")}<input value={facilityForm.supportedCropTypes} onChange={event => setFacilityForm(prev => ({ ...prev, supportedCropTypes: event.target.value }))} required placeholder={tx("cropTypesExample")} /></label>
                    <button className="primary-button batch-submit" disabled={warehouseBusy}>{warehouseBusy ? tx("registering") : tx("registerFacilityButton")}</button>
                  </form>
                </section>
                {warehouseLoading && warehouseFacilities.length === 0 ? <p className="empty-batches" role="status">{tx("loadingFacilitiesShort")}</p> : warehouseFacilities.length > 0 ? (
                  <>
                    <div className="facility-selector">
                      <label>{tx("currentFacility")}<select value={selectedFacilityId} onChange={event => setSelectedFacilityId(event.target.value)}>{warehouseFacilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name} · {facility.location}</option>)}</select></label>
                    </div>
                    {warehouseFacilities.filter(facility => facility.id === selectedFacilityId).map(facility => {
                      const utilization = facility.capacityKg > 0 ? Math.min(100, (facility.usedCapacityKg / facility.capacityKg) * 100) : 0;
                      return <section className="capacity-panel" key={facility.id}>
                        <div className="capacity-summary"><div><span className="eyebrow">{tx("capacityUsage")}</span><h3>{facility.name}</h3><p>{facility.location} · {tx("supportsCropTypes", { crops: facility.supportedCropTypes.join(", ") })}</p></div><strong>{utilization.toFixed(1)}%</strong></div>
                        <div className="capacity-meter" role="progressbar" aria-label={`${facility.name} capacity utilization`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(utilization)}><span style={{ width: `${utilization}%` }} /></div>
                        <div className="capacity-facts"><span>{tx("used")} <strong>{Number(facility.usedCapacityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span><span>{tx("available")} <strong>{Number(facility.availableCapacityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span><span>{tx("totalCapacity")} <strong>{Number(facility.capacityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span></div>
                      </section>;
                    })}
                    <section className="facility-register">
                      <h3>{tx("incomingBatch")}</h3>
                      <p className="comparison-hint">{tx("recordIncomingHint")}</p>
                      <form className="batch-form facility-form" onSubmit={recordIncomingBatch} aria-describedby={warehouseError ? "warehouse-form-error" : undefined}>
                        <label>{tx("existingBatchId")}<input value={incomingForm.batchId} onChange={event => setIncomingForm(prev => ({ ...prev, batchId: event.target.value.trim().toUpperCase() }))} required placeholder="FM-YYYYMMDD-XXXXXX" /></label>
                        <label>{tx("incomingQuantity")}<input type="number" min="0.01" max="100000000" step="0.01" value={incomingForm.quantityKg} onChange={event => setIncomingForm(prev => ({ ...prev, quantityKg: event.target.value }))} required /></label>
                        <label>{tx("storageType")}<select value={incomingForm.storageType} onChange={event => setIncomingForm(prev => ({ ...prev, storageType: event.target.value }))}>{["Ambient", "Cold", "Dry", "Refrigerated"].map(type => <option key={type}>{tx(type)}</option>)}</select></label>
                        <label>{tx("storageDate")}<input type="date" max={new Date().toISOString().slice(0, 10)} value={incomingForm.storageDate} onChange={event => setIncomingForm(prev => ({ ...prev, storageDate: event.target.value }))} required /></label>
                        <button className="primary-button batch-submit" disabled={warehouseBusy || !selectedFacilityId}>{warehouseBusy ? tx("recording") : tx("recordIncoming")}</button>
                      </form>
                    </section>
                    <section className="oldest-inventory">
                      <div className="batch-list-heading"><div><h3>{tx("longestStored")}</h3><p>{tx("oldestFirst")}</p></div></div>
                      {oldestStoredInventory.length === 0 ? <p className="empty-batches">{tx("noStock")}</p> : <div className="oldest-list">{oldestStoredInventory.map(item => {
                        const storedDays = Math.max(0, Math.floor((Date.now() - new Date(item.storageDate).getTime()) / 86400000));
                        return <div className="oldest-item" key={item.id}><strong>{item.cropName} · {item.batchId}</strong><span>{Number(item.storedQuantityKg).toLocaleString(i18n.resolvedLanguage)} kg · {storedDays} {tx(storedDays === 1 ? "day" : "days")}</span></div>;
                      })}</div>}
                    </section>
                    <section className="inventory-section">
                      <div className="batch-list-heading"><div><h3>{tx("warehouseInventory")}</h3><p>{tx("searchFilterInventory")}</p></div><button className="icon-button" type="button" onClick={() => refreshWarehouseInventory()} disabled={warehouseLoading} aria-label={tx("refreshInventory")}><RefreshCw size={16} /></button></div>
                      <div className="inventory-filters">
                        <label>{tx("search")}<input type="search" value={inventorySearch} onChange={event => setInventorySearch(event.target.value)} placeholder={tx("searchBatchOrCrop")} /></label>
                        <label>{tx("cropFilter")}<select value={inventoryCropFilter} onChange={event => setInventoryCropFilter(event.target.value)}><option value="">{tx("allCrops")}</option>{(warehouseFacilities.find(facility => facility.id === selectedFacilityId)?.supportedCropTypes || []).map(crop => <option key={crop} value={crop}>{crop}</option>)}</select></label>
                        <label>{tx("status")}<select value={inventoryStatusFilter} onChange={event => setInventoryStatusFilter(event.target.value)}><option value="">{tx("allStatuses")}</option>{["Stored", "Quality Check", "Spoiled", "Partially Dispatched", "Dispatched"].map(value => <option key={value}>{tx(value)}</option>)}</select></label>
                      </div>
                      {warehouseLoading ? <p className="empty-batches" role="status">{tx("loadingInventory")}</p> : warehouseInventory.length === 0 ? <div className="empty-batches"><strong>{tx("noMatchingInventory")}</strong><span>{tx("adjustInventoryFilters")}</span></div> : <div className="warehouse-inventory-grid">{warehouseInventory.map(item => <article className="inventory-card" key={item.id}>
                        <div className="batch-card-top"><span className="batch-id">{item.batchId}</span><span className={`interest-status ${item.status === "Stored" ? "accepted" : item.status === "Spoiled" ? "rejected" : "pending"}`}>{tx(item.status)}</span></div>
                        <h3>{item.cropName}</h3>
                        <div className="inventory-facts"><span>{tx("currentlyStored")}<strong>{Number(item.storedQuantityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span><span>{tx("received")}<strong>{Number(item.receivedQuantityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span><span>{tx("storageType")}<strong>{tx(item.storageType)}</strong></span><span>{tx("storedSince")}<strong>{new Date(item.storageDate).toLocaleDateString(i18n.resolvedLanguage)}</strong></span><span>{tx("dispatched")}<strong>{Number(item.dispatchedQuantityKg).toLocaleString(i18n.resolvedLanguage)} kg</strong></span></div>
                        <div className="inventory-actions">
                          <label>{tx("updateStatus")}<select value={item.status} onChange={event => changeInventoryStatus(item.id, event.target.value)} disabled={warehouseBusy || item.status === "Spoiled" || item.status === "Dispatched"}><option value="Stored">{tx("Stored")}</option><option value="Quality Check">{tx("Quality Check")}</option><option value="Spoiled">{tx("Spoiled")}</option>{item.status === "Partially Dispatched" && <option value="Partially Dispatched">{tx("Partially Dispatched")}</option>}{item.status === "Dispatched" && <option value="Dispatched">{tx("Dispatched")}</option>}</select></label>
                          {item.storedQuantityKg > 0 && <div className="outgoing-control"><label>{tx("outgoingQuantity")}<input type="number" min="0.01" max={item.storedQuantityKg} step="0.01" value={outgoingQuantities[item.id] || ""} onChange={event => setOutgoingQuantities(prev => ({ ...prev, [item.id]: event.target.value }))} /></label><button type="button" className="offer-select" disabled={warehouseBusy} onClick={() => dispatchInventory(item.id)}>{tx("recordOutgoing")}</button></div>}
                        </div>
                      </article>)}</div>}
                    </section>
                  </>
                ) : !warehouseLoading ? <div className="empty-batches"><strong>{tx("noFacilities")}</strong><span>{tx("registerFacilityHint")}</span></div> : null}
              </section>
            ) : user.role === "transporter" ? (
              <section className="farmer-workspace delivery-workspace">
                <div className="workspace-heading">
                  <div><span className="eyebrow">{tx("transportIntroEyebrow")}</span><h2>{tx("deliveryManagement")}</h2><p>{tx("manageDeliveryIntro")}</p></div>
                  <button className="icon-button" type="button" onClick={() => refreshDeliveries()} disabled={deliveryLoading} aria-label={tx("refreshDelivery")}><RefreshCw size={16} /></button>
                </div>
                {deliveryError && <p id="delivery-create-error" className="workflow-error" role="alert" aria-live="assertive">{messageText(deliveryError)}</p>}
                {deliveryMessage && <p className="workflow-message" role="status">{messageText(deliveryMessage)}</p>}
                <p className="manual-eta-note">{tx("deliveryManual")}</p>
                <div className="delivery-summary-grid">
                  <article><span>{tx("pendingCountLabel")}</span><strong>{pendingDeliveryCount}</strong></article>
                  <article><span>{tx("activeDeliveryCount")}</span><strong>{activeDeliveryCount}</strong></article>
                  <article><span>{tx("completedDeliveryCount")}</span><strong>{completedDeliveryCount}</strong></article>
                </div>
                <section className="delivery-section">
                  <div className="batch-list-heading"><div><h3>{tx("requestsSharedWithYou")}</h3><p>{tx("selectedTransporterOnly")}</p></div></div>
                  <DeliveryRequestCards requests={deliveryRequests} loading={deliveryLoading} onRespond={respondToDeliveryRequest} busyId={deliveryBusyId} />
                </section>
                <section className="delivery-section">
                  <div className="batch-list-heading"><div><h3>{tx("ownDeliveryRecord")}</h3><p>{tx("ownDeliveryIntro")}</p></div></div>
                  <DeliveryDetailsForm form={deliveryForm} onChange={updateDeliveryForm} onSubmit={createDeliveryRecord} busy={deliveryBusyId === "request-form"} mode="create" error={deliveryError} />
                </section>
                <section className="delivery-section">
                  <div className="batch-list-heading"><div><h3>{tx("yourDeliveries")}</h3><p>{tx("nextStatusOnly")}</p></div></div>
                  <DeliveryCards deliveries={deliveries} loading={deliveryLoading} onStatus={updateDeliveryStatus} busyId={deliveryBusyId} />
                </section>
              </section>
            ) : (
              <div className="notice-card"><ShieldCheck size={21} /><div><strong>{tx("workspaceFoundation")}</strong><p>{tx("nextRoleWorkflow", { role: t(user.role) })}</p></div></div>
            )}
            <button className="secondary-button" onClick={() => { setPage("home"); }}>{tx("viewDashboards")}</button>
          </section>
        </main>
      )}
    </div>
  );
}

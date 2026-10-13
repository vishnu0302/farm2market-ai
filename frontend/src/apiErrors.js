import i18n from "./i18n.js";

export const API_ERROR_TRANSLATION_KEYS = Object.freeze({
  AUTH_REQUIRED: "apiErrorAuthRequired",
  CONFLICT: "apiErrorConflict",
  DUPLICATE_ACCOUNT: "apiErrorDuplicateAccount",
  DUPLICATE_RECORD: "apiErrorDuplicateRecord",
  FORBIDDEN: "apiErrorForbidden",
  INVALID_CREDENTIALS: "apiErrorInvalidCredentials",
  INVALID_INPUT: "apiErrorInvalidInput",
  MARKET_API_INVALID_RESPONSE: "apiErrorMarketInvalidResponse",
  MARKET_API_KEY_REJECTED: "apiErrorMarketKeyRejected",
  MARKET_API_FORBIDDEN: "apiErrorMarketForbidden",
  MARKET_API_HTTP_ERROR: "apiErrorMarketHttpError",
  MARKET_API_INCOMPLETE_LOCATION_DATA: "apiErrorMarketIncompleteLocationData",
  MARKET_API_NETWORK_ERROR: "apiErrorMarketNetworkError",
  MARKET_API_RATE_LIMITED: "apiErrorMarketRateLimited",
  MARKET_API_SCHEMA_UNRECOGNIZED: "apiErrorMarketSchemaUnrecognized",
  MARKET_API_SERVER_ERROR: "apiErrorMarketServerError",
  MARKET_API_TIMEOUT: "apiErrorMarketTimeout",
  MARKET_API_UNAVAILABLE: "apiErrorMarketUnavailable",
  PRICE_DATA_UNAVAILABLE: "apiErrorPriceDataUnavailable",
  MARKET_RECORD_EXPIRED: "apiErrorMarketRecordExpired",
  MARKET_PRICE_UNIT_UNVERIFIED: "apiErrorMarketUnitUnverified",
  NETWORK_ERROR: "apiErrorNetwork",
  NOT_FOUND: "apiErrorNotFound",
  REQUEST_FAILED: "apiErrorRequestFailed",
  SERVER_ERROR: "apiErrorServer",
  SESSION_INVALID: "apiErrorSessionInvalid",
  UNAUTHENTICATED: "apiErrorAuthRequired",
  UNKNOWN_ERROR: "apiErrorUnknown"
});

export const API_NOTICE_TRANSLATION_KEYS = Object.freeze({
  BATCH_PUBLISHED: "noticeBatchPublished",
  DELIVERY_CREATED: "noticeDeliveryCreated",
  DELIVERY_REQUEST_ACCEPTED: "noticeDeliveryRequestAccepted",
  DELIVERY_REQUEST_REJECTED: "noticeDeliveryRequestRejected",
  DELIVERY_REQUEST_SHARED: "noticeDeliveryRequestShared",
  DELIVERY_STATUS_UPDATED: "noticeDeliveryStatusUpdated",
  FACILITY_REGISTERED: "noticeFacilityRegistered",
  INVENTORY_RECEIVED: "noticeInventoryReceived",
  INVENTORY_STATUS_UPDATED: "noticeInventoryStatusUpdated",
  OUTGOING_RECORDED: "noticeOutgoingRecorded",
  PURCHASE_INTEREST_ACCEPTED: "noticePurchaseInterestAccepted",
  PURCHASE_INTEREST_REJECTED: "noticePurchaseInterestRejected",
  PURCHASE_INTEREST_SENT: "noticePurchaseInterestSent",
  WAREHOUSE_AUTHORIZED: "noticeWarehouseAuthorized",
  WAREHOUSE_AUTHORIZATION_REVOKED: "noticeWarehouseAuthorizationRevoked"
});

export function apiNoticeMessage(noticeCode) {
  const key = API_NOTICE_TRANSLATION_KEYS[noticeCode] || "noticeRequestSucceeded";
  return i18n.t(`ui.${key}`);
}

export function apiErrorCodeForStatus(status) {
  if (status === 400 || status === 413 || status === 422) return "INVALID_INPUT";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status >= 500) return "SERVER_ERROR";
  return "REQUEST_FAILED";
}

export function normalizeApiErrorCode(code, status) {
  return typeof code === "string" && Object.hasOwn(API_ERROR_TRANSLATION_KEYS, code)
    ? code
    : apiErrorCodeForStatus(status);
}

export function apiErrorMessage(code) {
  const key = API_ERROR_TRANSLATION_KEYS[code] || API_ERROR_TRANSLATION_KEYS.UNKNOWN_ERROR;
  return i18n.t(`ui.${key}`);
}

export class ApiError extends Error {
  constructor(code, status) {
    const normalizedCode = normalizeApiErrorCode(code, status);
    super(normalizedCode);
    this.name = "ApiError";
    this.code = normalizedCode;
    this.status = status;
    Object.defineProperty(this, "message", {
      configurable: true,
      get: () => apiErrorMessage(this.code)
    });
  }
}

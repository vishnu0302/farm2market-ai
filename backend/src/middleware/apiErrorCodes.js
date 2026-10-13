export function apiErrorCodeForStatus(status) {
  if (status === 400 || status === 413 || status === 422) return "INVALID_INPUT";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status >= 500) return "SERVER_ERROR";
  return "REQUEST_FAILED";
}

export function addApiErrorCode(req, res, next) {
  const originalJson = res.json;
  res.json = function jsonWithErrorCode(body) {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      !body.code
    ) {
      body = { ...body, code: apiErrorCodeForStatus(res.statusCode) };
    }
    return originalJson.call(this, body);
  };
  next();
}

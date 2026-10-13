import { apiErrorCodeForStatus } from "./apiErrorCodes.js";

export function notFound(req, res, _next) {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found." });
}

export function errorHandler(err, _req, res, _next) {
  console.error(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({
    code: apiErrorCodeForStatus(status),
    message: status < 500 ? err.message : "Unexpected server error."
  });
}

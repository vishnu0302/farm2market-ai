import { ApiError, normalizeApiErrorCode } from "./apiErrors.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function apiRequest(path, { method = "GET", body, token } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError("NETWORK_ERROR", 0);
    throw new ApiError("UNKNOWN_ERROR", 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(normalizeApiErrorCode(data?.code, response.status), response.status);
  }
  return data;
}

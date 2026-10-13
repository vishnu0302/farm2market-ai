import assert from "node:assert/strict";
import { test } from "node:test";
import { addApiErrorCode, apiErrorCodeForStatus } from "../src/middleware/apiErrorCodes.js";

test("HTTP failures receive stable machine-readable categories", () => {
  assert.equal(apiErrorCodeForStatus(400), "INVALID_INPUT");
  assert.equal(apiErrorCodeForStatus(401), "UNAUTHENTICATED");
  assert.equal(apiErrorCodeForStatus(403), "FORBIDDEN");
  assert.equal(apiErrorCodeForStatus(404), "NOT_FOUND");
  assert.equal(apiErrorCodeForStatus(409), "CONFLICT");
  assert.equal(apiErrorCodeForStatus(500), "SERVER_ERROR");
  assert.equal(apiErrorCodeForStatus(503), "SERVER_ERROR");
});

test("error-code middleware preserves messages and explicit codes", () => {
  let responseBody;
  const response = {
    statusCode: 400,
    json(body) {
      responseBody = body;
      return body;
    }
  };
  let passedNext = false;

  addApiErrorCode({}, response, () => { passedNext = true; });
  response.json({ message: "English validation detail." });
  assert.equal(passedNext, true);
  assert.deepEqual(responseBody, {
    message: "English validation detail.",
    code: "INVALID_INPUT"
  });

  response.statusCode = 401;
  response.json({ code: "SESSION_INVALID", message: "Legacy-compatible message." });
  assert.equal(responseBody.code, "SESSION_INVALID");

  response.statusCode = 200;
  response.json({ message: "Success" });
  assert.deepEqual(responseBody, { message: "Success" });
});

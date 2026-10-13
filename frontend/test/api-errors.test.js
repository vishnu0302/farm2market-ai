import assert from "node:assert/strict";
import { test } from "node:test";
import i18n from "../src/i18n.js";
import {
  API_ERROR_TRANSLATION_KEYS,
  API_NOTICE_TRANSLATION_KEYS,
  ApiError,
  apiNoticeMessage,
  apiErrorCodeForStatus,
  normalizeApiErrorCode
} from "../src/apiErrors.js";

const languages = ["en", "te", "hi", "ta"];
const validationKeys = [
  "validationRequired",
  "validationEmail",
  "validationMinLength",
  "validationMaxLength",
  "validationMinimum",
  "validationMaximum",
  "validationNumber",
  "validationField"
];

test("every API error category has a translation in every supported language", () => {
  const originalLanguage = i18n.language;
  for (const language of languages) {
    i18n.changeLanguage(language);
    const dictionary = i18n.store.data[language].translation.ui;
    for (const [code, key] of Object.entries(API_ERROR_TRANSLATION_KEYS)) {
      const message = new ApiError(code, 400).message;
      assert.ok(message, `Missing ${language} translation for ${code}`);
      assert.notEqual(message, `ui.${key}`, `Unresolved translation for ${language}.${code}`);
      assert.notEqual(message, code, `Raw error code displayed for ${language}.${code}`);
    }
    for (const [code, key] of Object.entries(API_NOTICE_TRANSLATION_KEYS)) {
      assert.ok(dictionary[key], `Missing ${language} success translation for ${code}`);
      assert.notEqual(apiNoticeMessage(code), `ui.${key}`);
    }
    assert.ok(apiNoticeMessage("FUTURE_NOTICE_CODE"));
    for (const key of validationKeys) {
      assert.ok(dictionary[key], `Missing ${language} form-validation translation for ${key}`);
    }
  }
  i18n.changeLanguage(originalLanguage);
});

test("API errors follow the active language and never expose unknown server text", () => {
  const error = new ApiError("SERVER_ERROR", 500);
  i18n.changeLanguage("en");
  const english = error.message;
  i18n.changeLanguage("te");
  const telugu = error.message;

  assert.notEqual(english, telugu);
  assert.equal(normalizeApiErrorCode("INTERNAL_STACK_TRACE", 500), "SERVER_ERROR");
  assert.equal(new ApiError("INTERNAL_STACK_TRACE", 500).message, telugu);
  i18n.changeLanguage("en");
});

test("unknown response codes fall back to stable status categories", () => {
  assert.equal(normalizeApiErrorCode("UNKNOWN_BACKEND_CODE", 404), "NOT_FOUND");
  assert.equal(normalizeApiErrorCode(undefined, 409), "CONFLICT");
  assert.equal(normalizeApiErrorCode(undefined, 0), "REQUEST_FAILED");
  assert.equal(apiErrorCodeForStatus(413), "INVALID_INPUT");
});

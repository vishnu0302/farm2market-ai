import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import i18n from "../src/i18n.js";

const languages = ["en", "te", "hi", "ta"];
const dictionaries = Object.fromEntries(
  languages.map(language => [language, i18n.store.data[language]?.translation?.ui])
);

test("all supported languages have matching, non-empty screen translations", () => {
  const referenceKeys = Object.keys(dictionaries.en).sort();

  for (const language of languages) {
    const dictionary = dictionaries[language];
    assert.ok(dictionary, `Missing translation resource for ${language}`);
    assert.deepEqual(Object.keys(dictionary).sort(), referenceKeys, `Key mismatch in ${language}`);
    for (const key of referenceKeys) {
      assert.equal(typeof dictionary[key], "string", `${language}.${key} is not text`);
      assert.notEqual(dictionary[key].trim(), "", `${language}.${key} is empty`);
    }
  }
});

test("literal UI translation calls used by the app exist in every locale", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const keys = [...app.matchAll(/tx\(["']([A-Za-z][A-Za-z0-9 ]*)["']/g)]
    .map((match) => match[1]);

  for (const language of languages) {
    for (const key of keys) {
      assert.ok(key in dictionaries[language], `Missing ${language} translation for ${key}`);
    }
  }
});

test("interpolation variables remain consistent across locales", () => {
  const placeholders = value => [...value.matchAll(/\{\{([^}]+)\}\}/g)]
    .map(match => match[1])
    .sort();
  const reference = dictionaries.en;

  for (const language of languages.slice(1)) {
    for (const key of Object.keys(reference)) {
      assert.deepEqual(
        placeholders(dictionaries[language][key]),
        placeholders(reference[key]),
        `Interpolation mismatch for ${language}.${key}`
      );
    }
  }
});

test("Telugu and Tamil UI text do not contain the other language's script", () => {
  const te = dictionaries.te;
  const ta = dictionaries.ta;

  for (const [key, value] of Object.entries(te)) {
    assert.doesNotMatch(value, /[\u0B80-\u0BFF]/, `Telugu key ${key} contains Tamil script`);
  }
  for (const [key, value] of Object.entries(ta)) {
    assert.doesNotMatch(value, /[\u0C00-\u0C7F]/, `Tamil key ${key} contains Telugu script`);
  }
});

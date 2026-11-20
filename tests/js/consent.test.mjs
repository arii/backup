// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// consent.js: dated opt-in record for shoulder and breathing features.

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSENT_POINTS, CONSENT_VERSION, consentStatus, hasConsent, recordConsent, withdrawConsent,
} from "../../docs/app/consent.js";
import { STORE_KEYS, clearStoredData } from "../../docs/app/privacy.js";

test("no consent by default and for malformed records", () => {
  assert.equal(hasConsent({}), false);
  assert.equal(hasConsent(null), false);
  assert.equal(hasConsent({ consent: true }), false);
  assert.equal(hasConsent({ consent: { version: 1, at: "not a date" } }), false);
  assert.equal(hasConsent({ consent: { version: 0, at: "2026-01-01T00:00:00.000Z" } }), false);
});

test("recording stores a version and an ISO date; withdrawing removes it", () => {
  const store = {};
  recordConsent(store, Date.parse("2026-03-04T05:06:07Z"));
  assert.deepEqual(store.consent, { version: CONSENT_VERSION, at: "2026-03-04T05:06:07.000Z" });
  assert.equal(hasConsent(store), true);
  assert.match(consentStatus(store), /2026-03-04/);
  withdrawConsent(store);
  assert.equal(hasConsent(store), false);
  assert.match(consentStatus(store), /need your OK/);
});

test("a record for the current or a newer version counts", () => {
  assert.equal(hasConsent({ consent: { version: CONSENT_VERSION, at: "2026-01-01T00:00:00Z" } }), true);
  assert.equal(hasConsent({ consent: { version: CONSENT_VERSION + 1, at: "2026-01-01T00:00:00Z" } }), true);
});

test("the text covers what, where, kept, identify and withdraw", () => {
  const t = CONSENT_POINTS.join(" ");
  for (const re of [/measured/, /only in this browser tab/, /no video, images or landmark/i, /identify/, /withdraw/]) assert.match(t, re);
});

test("Delete my data removes the consent record (it lives in the one store key)", () => {
  const mem = new Map([[STORE_KEYS[0], JSON.stringify(recordConsent({}))]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, removeItem: (k) => mem.delete(k) };
  assert.equal(clearStoredData(storage), true);
  assert.equal(storage.getItem(STORE_KEYS[0]), null);
});

// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// sponsor.js: gating of the sponsor card with a fake clock and store.

import assert from "node:assert/strict";
import test from "node:test";
import {
  SPONSOR, answerSponsor, markSponsorShown, recordSession, shouldOfferSponsor, sponsorText, usageTotals,
} from "../../docs/app/sponsor.js";

const DAY = 86400000;
const T0 = Date.parse("2026-01-01T12:00:00Z");
const at = (days) => T0 + days * DAY;
const GOOD = { good: true, silent: false };

/** A store with enough use: 6 sessions on 4 days, 3 h tracked, first seen on day 0. */
function usedStore() {
  const s = { usage: { firstSeen: "2026-01-01", sessions: 6 }, days: {} };
  for (const d of ["2026-01-01", "2026-01-03", "2026-01-05", "2026-01-08"]) s.days[d] = { good: 2400, bad: 600 };
  return s;
}
const ask = (s, days, ctx = GOOD) => shouldOfferSponsor(s, { nowMs: at(days), ...ctx });

test("shown after sustained use, once the first week is over", () => {
  assert.equal(ask(usedStore(), 8), true);
});

test("not in the first week", () => {
  assert.equal(ask(usedStore(), 6), false);
  assert.equal(ask(usedStore(), 7), true);
});

test("needs 5 sessions, 3 distinct days and 2 hours", () => {
  const few = usedStore(); few.usage.sessions = 4;
  assert.equal(ask(few, 10), false);
  const fewDays = usedStore(); fewDays.days = { "2026-01-01": { good: 20000, bad: 0 }, "2026-01-02": { good: 100, bad: 0 } };
  assert.equal(ask(fewDays, 10), false);
  const short = usedStore();
  for (const d of Object.values(short.days)) { d.good = 100; d.bad = 100; }
  assert.equal(usageTotals(short).seconds, 800);
  assert.equal(ask(short, 10), false);
  const exact = usedStore(); // 4 x 3000 s = 12000 s
  for (const d of Object.values(exact.days)) { d.good = 1800; d.bad = 0; } // 7200 s = 2 h exactly
  assert.equal(ask(exact, 10), true);
});

test("only in a good stretch, never silent, paused or in a test", () => {
  assert.equal(ask(usedStore(), 10, { good: false, silent: false }), false);
  assert.equal(ask(usedStore(), 10, { good: true, silent: true }), false);
});

test("shown at most 3 times, ever", () => {
  const s = usedStore();
  for (let i = 0; i < 3; i++) {
    assert.equal(ask(s, 10 + i * 100), true, `show ${i + 1}`);
    markSponsorShown(s);
  }
  assert.equal(ask(s, 1000), false);
});

test("Maybe later waits 30 more days", () => {
  const s = usedStore();
  markSponsorShown(s);
  answerSponsor(s, "later", at(10));
  assert.equal(ask(s, 10 + SPONSOR.later_days - 1), false);
  assert.equal(ask(s, 10 + SPONSOR.later_days), true);
});

test("Don't ask again is permanent", () => {
  const s = usedStore();
  answerSponsor(s, "never", at(10));
  assert.equal(ask(s, 5000), false);
});

test("recordSession keeps the first day and counts sessions; junk is repaired", () => {
  const s = {};
  recordSession(s, at(0)); recordSession(s, at(5));
  assert.deepEqual(s.usage, { firstSeen: "2026-01-01", sessions: 2 });
  const junk = { usage: { firstSeen: "yesterday", sessions: "x" }, days: { bad: 1, "2026-01-01": null } };
  recordSession(junk, at(3));
  assert.deepEqual(junk.usage, { firstSeen: "2026-01-04", sessions: 1 });
  assert.deepEqual(usageTotals(junk), { sessions: 1, days: 0, seconds: 0 });
});

test("the card text states tracked hours, no outcome claim", () => {
  const t = sponsorText(usedStore());
  assert.match(t, /about 3 hours/);
  assert.doesNotMatch(t, /better|reduce|fix|prevent/i);
});

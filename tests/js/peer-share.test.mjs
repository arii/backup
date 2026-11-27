// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Peer share link (progress-review task 9, spec P8) and its consent record (task 10).

import assert from "node:assert/strict";
import test from "node:test";
import {
  SHARE_CONSENT_POINTS,
  hasShareConsent,
  recordShareConsent,
  withdrawShareConsent,
} from "../../docs/app/consent.js";
import { STORE_KEYS, clearStoredData } from "../../docs/app/privacy.js";
import { PEER_KEYS, cleanNickname, isPeerRecord, peerLink, peerRecord, readPeerLink } from "../../docs/app/share.js";

const BASE = "https://arii.github.io/backup/app/";
const good = { nickname: "Ari", week: "2026-W15", tracked_s: 7260, score: 64, breaks: 5 };

test("P8: the record has exactly the documented keys", () => {
  const rec = peerRecord(good);
  assert.deepEqual(Object.keys(rec).sort(), [...PEER_KEYS].sort());
  assert.deepEqual(rec, {
    schema: 1,
    week: "2026-W15",
    nickname: "Ari",
    tracked_minutes: 121,
    consistency_score: 64,
    breaks_taken: 5,
  });
});

test("nicknames are short pseudonyms: no @, no email, no markup", () => {
  assert.equal(cleanNickname("  Ari   B  "), "Ari B");
  assert.equal(cleanNickname("Zoë_1"), "Zoë_1");
  for (const bad of [
    "",
    "   ",
    "a@b.co",
    "@ari",
    "x".repeat(21),
    "<b>",
    "a/b",
    "https://x.y",
    null,
    undefined,
    "-lead",
  ]) {
    assert.equal(cleanNickname(bad), null, String(bad));
  }
  assert.equal(peerRecord({ ...good, nickname: "me@mail.com" }), null);
});

test("out-of-range numbers and weeks give no record", () => {
  for (const patch of [
    { score: 101 },
    { score: -1 },
    { score: 5.5 },
    { breaks: -1 },
    { week: "2026-15" },
    { week: "2026-W54" },
    { week: "<script>" },
  ]) {
    assert.equal(peerRecord({ ...good, ...patch }), null, JSON.stringify(patch));
  }
  assert.ok(peerRecord({ ...good, tracked_s: Number.NaN }), "NaN tracked time counts as 0");
});

test("tracked minutes and breaks above the limits are capped, not rejected", () => {
  const rec = peerRecord({ ...good, tracked_s: 8 * 7 * 24 * 3600, breaks: 5000 });
  assert.equal(rec.tracked_minutes, 7 * 24 * 60);
  assert.equal(rec.breaks_taken, 1000);
  assert.ok(isPeerRecord(rec));
});

test("link round trip keeps the record, and carries it in the fragment only", () => {
  const rec = peerRecord({ ...good, nickname: "Zoë" });
  const link = peerLink(rec, `${BASE}?clockScale=60`);
  const u = new URL(link);
  assert.equal(u.search, "", "no query string, so a server log never sees the data");
  assert.ok(u.hash.startsWith("#peer="));
  assert.equal(`${u.origin}${u.pathname}`, BASE);
  assert.deepEqual(readPeerLink(link), rec);
  assert.deepEqual(readPeerLink(u.hash), rec);
  assert.deepEqual(readPeerLink(u.hash.slice(6)), rec, "a bare code works");
});

test("the link payload contains no field beyond the six keys", () => {
  const link = peerLink(peerRecord(good), BASE);
  const code = link.split("#peer=")[1];
  const json = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(json), [...PEER_KEYS]);
});

test("peerLink refuses a bad record; readPeerLink rejects tampered or foreign input", () => {
  assert.throws(() => peerLink({ ...peerRecord(good), extra: 1 }, BASE));
  assert.throws(() => peerLink(null, BASE));
  const enc = (o) => `#peer=${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
  const rec = peerRecord(good);
  assert.equal(readPeerLink(enc({ ...rec, extra: "email" })), null, "extra key");
  assert.equal(readPeerLink(enc({ ...rec, consistency_score: 500 })), null);
  assert.equal(readPeerLink(enc({ ...rec, nickname: "a@b.c" })), null);
  const { breaks_taken: _drop, ...partial } = rec;
  assert.equal(readPeerLink(enc(partial)), null, "missing key");
  for (const junk of [
    "",
    "   ",
    "#peer=",
    "#peer=!!!",
    "#peer=e30",
    "hello world",
    null,
    undefined,
    "#peer=" + "A".repeat(3000),
  ]) {
    assert.equal(readPeerLink(junk), null, String(junk).slice(0, 20));
  }
});

test("isPeerRecord rejects non-objects and arrays", () => {
  for (const v of [null, undefined, 5, "x", [], Object.create(null)]) assert.equal(isPeerRecord(v), false);
});

test("share consent: off by default, dated record, withdraw removes it and the nickname", () => {
  assert.equal(hasShareConsent({}), false);
  assert.equal(hasShareConsent(null), false);
  assert.equal(hasShareConsent({ shareConsent: true }), false);
  assert.equal(hasShareConsent({ shareConsent: { version: 1, at: "nope" } }), false);
  assert.equal(
    hasShareConsent({ consent: { version: 1, at: "2026-01-01T00:00:00.000Z" } }),
    false,
    "landmark consent is not sharing consent",
  );
  const store = { shareNickname: "Ari" };
  recordShareConsent(store, Date.UTC(2026, 3, 10));
  assert.equal(store.shareConsent.at, "2026-04-10T00:00:00.000Z");
  assert.equal(hasShareConsent(store), true);
  withdrawShareConsent(store);
  assert.equal(hasShareConsent(store), false);
  assert.equal("shareNickname" in store, false);
});

test("consent text says what is shared, that nothing is sent by the site, and that copies cannot be taken back", () => {
  const text = SHARE_CONSENT_POINTS.join(" ");
  for (const needle of ["nickname", "consistency score", "breaks", "no server", "cannot take back", "No video"]) {
    assert.ok(text.toLowerCase().includes(needle.toLowerCase()), needle);
  }
});

test("Delete my data clears the share consent (it lives in the main store key)", () => {
  const removed = [];
  clearStoredData({ removeItem: (k) => removed.push(k) });
  assert.ok(removed.includes("posture-guard:v1"));
  assert.ok(STORE_KEYS.includes("posture-guard:v1"));
});

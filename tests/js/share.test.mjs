// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// share.js: share text, plain links and Mastodon instance validation.

import assert from "node:assert/strict";
import test from "node:test";
import { nativeSharePayload, normalizeInstance, SHARE_TEXT, shareLinks, shareUrl } from "../../docs/app/share.js";

const URL_ = "https://arii.github.io/backup/";

test("share text is the agreed sentence", () => {
  assert.equal(
    SHARE_TEXT,
    "BackUp: Posture to Die For. A free webcam posture coach that runs in your browser. Nothing is uploaded.",
  );
});

test("links carry the text and the URL, encoded", () => {
  const l = shareLinks(URL_);
  assert.ok(l.bluesky.startsWith("https://bsky.app/intent/compose?text="));
  assert.ok(l.bluesky.includes(encodeURIComponent(URL_)));
  assert.ok(l.x.startsWith("https://x.com/intent/post?text=") && l.x.includes("url=" + encodeURIComponent(URL_)));
  assert.ok(l.linkedin.includes("url=" + encodeURIComponent(URL_)));
  assert.ok(l.email.startsWith("mailto:?subject="));
  assert.equal(l.mastodon, undefined);
});

test("every web link points at a fixed, known host", () => {
  const hosts = Object.values(shareLinks(URL_, { instance: "Mastodon.Social" }))
    .filter((u) => u.startsWith("http"))
    .map((u) => new URL(u).hostname)
    .sort();
  assert.deepEqual(hosts, ["bsky.app", "mastodon.social", "www.linkedin.com", "x.com"]);
});

test("mastodon instance must be a plain hostname", () => {
  assert.equal(normalizeInstance(" Mastodon.Social "), "mastodon.social");
  assert.equal(normalizeInstance("@fosstodon.org"), "fosstodon.org");
  for (const bad of [
    "",
    "localhost",
    "https://mastodon.social",
    "mastodon.social/path",
    "a b.com",
    "evil.com@x.com",
    "mastodon.social:8080",
    "1.2.3.4",
    "-bad.example.com",
    "x.c",
    "javascript:alert(1)",
    "a.com?x=1",
    null,
    undefined,
  ]) {
    assert.equal(normalizeInstance(bad), null, String(bad));
  }
  assert.equal(shareLinks(URL_, { instance: "evil.com/steal" }).mastodon, undefined);
  assert.equal(new URL(shareLinks(URL_, { instance: "social.example.org" }).mastodon).hostname, "social.example.org");
});

test("native payload and share URL (no query, no hash)", () => {
  assert.deepEqual(nativeSharePayload(URL_), { title: "BackUp: Posture to Die For", text: SHARE_TEXT, url: URL_ });
  assert.equal(shareUrl("https://arii.github.io/backup/app/?clockScale=600#x"), URL_);
});

import { CARD, cardAltText, drawScoreCard, scoreCardData } from "../../docs/app/share.js";

test("score card data: needs a minute of tracking, rounds, caps the streak", () => {
  assert.equal(scoreCardData({ good: 30, bad: 20, best: 30 }), null);
  assert.equal(scoreCardData(), null);
  assert.deepEqual(scoreCardData({ good: 750, bad: 250, best: 185 }), { pct: 75, goodMin: 13, bestMin: 3, bestSec: 5 });
  assert.equal(scoreCardData({ good: 100, bad: 0, best: 500 }).bestMin, 1);
  assert.equal(scoreCardData({ good: NaN, bad: 120, best: -4 }).pct, 0);
});

test("score card draws only score text on a fake canvas context", () => {
  const texts = [];
  const ctx = new Proxy(
    { fillText: (t) => texts.push(t), fillRect() {} },
    {
      set(o, k, v) {
        o[k] = v;
        return true;
      },
    },
  );
  const d = scoreCardData({ good: 900, bad: 100, best: 300 });
  drawScoreCard(ctx, d);
  assert.deepEqual(texts.slice(2, 5), ["90%", "good posture this session", "Best streak 5 min 0 s"]);
  assert.equal((CARD.width / CARD.height) | 0, 1);
  assert.match(cardAltText(d), /90% good posture/);
});

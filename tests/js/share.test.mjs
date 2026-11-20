// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// share.js: share text, plain links and Mastodon instance validation.

import assert from "node:assert/strict";
import test from "node:test";
import { SHARE_TEXT, nativeSharePayload, normalizeInstance, shareLinks, shareUrl } from "../../docs/app/share.js";

const URL_ = "https://arii.github.io/posture-guard/";

test("share text is the agreed sentence", () => {
  assert.equal(SHARE_TEXT, "BackUp — Posture to Die For: a free webcam posture coach that runs in your browser. Nothing is uploaded.");
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
    .filter((u) => u.startsWith("http")).map((u) => new URL(u).hostname).sort();
  assert.deepEqual(hosts, ["bsky.app", "mastodon.social", "www.linkedin.com", "x.com"]);
});

test("mastodon instance must be a plain hostname", () => {
  assert.equal(normalizeInstance(" Mastodon.Social "), "mastodon.social");
  assert.equal(normalizeInstance("@fosstodon.org"), "fosstodon.org");
  for (const bad of ["", "localhost", "https://mastodon.social", "mastodon.social/path", "a b.com", "evil.com@x.com",
    "mastodon.social:8080", "1.2.3.4", "-bad.example.com", "x.c", "javascript:alert(1)", "a.com?x=1", null, undefined]) {
    assert.equal(normalizeInstance(bad), null, String(bad));
  }
  assert.equal(shareLinks(URL_, { instance: "evil.com/steal" }).mastodon, undefined);
  assert.equal(new URL(shareLinks(URL_, { instance: "social.example.org" }).mastodon).hostname, "social.example.org");
});

test("native payload and share URL (no query, no hash)", () => {
  assert.deepEqual(nativeSharePayload(URL_), { title: "BackUp — Posture to Die For", text: SHARE_TEXT, url: URL_ });
  assert.equal(shareUrl("https://arii.github.io/posture-guard/app/?clockScale=600#x"), URL_);
});

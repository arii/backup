// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Share helpers: the share text and plain links, no DOM, no network. Every
// link is a normal URL the user opens themselves, so nothing third-party is
// loaded by this site (no widgets, no counters, no scripts). Tested in
// tests/js/share.test.mjs.

export const SHARE_TEXT =
  "BackUp — Posture to Die For: a free webcam posture coach that runs in your browser. Nothing is uploaded.";

/** A Mastodon instance is a bare hostname such as "mastodon.social". Returns
 *  the lower-case hostname, or null when the input is not a plain hostname
 *  (no scheme, path, port, credentials or spaces; at least one dot). */
export function normalizeInstance(input) {
  const raw = String(input ?? "").trim().toLowerCase().replace(/^@+/, "");
  if (!raw || raw.length > 253) return null;
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^(?:${label}\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$`).test(raw)) return null;
  return raw;
}

const q = encodeURIComponent;

/** Plain share links for `url`. Mastodon is included only for a valid instance. */
export function shareLinks(url, { text = SHARE_TEXT, instance = null } = {}) {
  const both = `${text} ${url}`;
  const links = {
    bluesky: `https://bsky.app/intent/compose?text=${q(both)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`,
    x: `https://x.com/intent/post?text=${q(text)}&url=${q(url)}`,
    email: `mailto:?subject=${q("BackUp — Posture to Die For")}&body=${q(both)}`,
  };
  const host = normalizeInstance(instance);
  if (host) links.mastodon = `https://${host}/share?text=${q(both)}`;
  return links;
}

/** Payload for navigator.share(). */
export function nativeSharePayload(url, text = SHARE_TEXT) {
  return { title: "BackUp — Posture to Die For", text, url };
}

/** The URL to share: the landing page (no query or hash, so test hooks are not shared). */
export function shareUrl(href) {
  const u = new URL("../", href);
  u.search = "";
  u.hash = "";
  return u.href;
}

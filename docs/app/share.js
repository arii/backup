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

// -- Score card: a PNG drawn on a canvas from two numbers. It never contains a
// camera frame, the skeleton or any other personal data. --

export const CARD = Object.freeze({ width: 1200, height: 630, min_tracked_s: 60 });

/** Card numbers from this session's seconds, or null when there is too little data to be honest. */
export function scoreCardData({ good = 0, bad = 0, best = 0 } = {}) {
  const g = Number.isFinite(good) && good > 0 ? good : 0;
  const b = Number.isFinite(bad) && bad > 0 ? bad : 0;
  if (g + b < CARD.min_tracked_s) return null;
  const bestS = Number.isFinite(best) && best > 0 ? Math.min(best, g) : 0;
  return {
    pct: Math.round((100 * g) / (g + b)),
    goodMin: Math.round(g / 60),
    bestMin: Math.floor(bestS / 60),
    bestSec: Math.floor(bestS % 60),
  };
}

export const cardAltText = (d) =>
  `BackUp score card: ${d.pct}% good posture this session, best streak ${d.bestMin} minutes ${d.bestSec} seconds.`;

/** Draw the card on a 2D context (real or fake). */
export function drawScoreCard(ctx, d, { width = CARD.width, height = CARD.height } = {}) {
  ctx.fillStyle = "#0f1720";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#4cc38a";
  ctx.fillRect(0, 0, 16, height);
  ctx.textBaseline = "alphabetic";
  const font = (px, weight = "700") => { ctx.font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`; };
  ctx.fillStyle = "#e8eef5";
  font(56);
  ctx.fillText("BackUp", 80, 120);
  font(32, "400");
  ctx.fillStyle = "#9fb0c3";
  ctx.fillText("Posture to Die For", 80, 168);
  ctx.fillStyle = "#4cc38a";
  font(240);
  ctx.fillText(`${d.pct}%`, 80, 400);
  ctx.fillStyle = "#e8eef5";
  font(44, "400");
  ctx.fillText("good posture this session", 80, 470);
  ctx.fillStyle = "#9fb0c3";
  font(34, "400");
  ctx.fillText(`Best streak ${d.bestMin} min ${d.bestSec} s`, 80, 530);
  font(28, "400");
  ctx.fillText("Free, runs in your browser, nothing uploaded", 80, 585);
}

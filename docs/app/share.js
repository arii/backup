// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Share helpers: the share text and plain links, no DOM, no network. Every
// link is a normal URL the user opens themselves, so nothing third-party is
// loaded by this site (no widgets, no counters, no scripts). Tested in
// tests/js/share.test.mjs.

export const SHARE_TEXT =
  "BackUp: Posture to Die For. A free webcam posture coach that runs in your browser. Nothing is uploaded.";

/** A Mastodon instance is a bare hostname such as "mastodon.social". Returns
 *  the lower-case hostname, or null when the input is not a plain hostname
 *  (no scheme, path, port, credentials or spaces; at least one dot). */
export function normalizeInstance(input) {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
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
    email: `mailto:?subject=${q("BackUp: Posture to Die For")}&body=${q(both)}`,
  };
  const host = normalizeInstance(instance);
  if (host) links.mastodon = `https://${host}/share?text=${q(both)}`;
  return links;
}

/** Payload for navigator.share(). */
export function nativeSharePayload(url, text = SHARE_TEXT) {
  return { title: "BackUp: Posture to Die For", text, url };
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
  const font = (px, weight = "700") => {
    ctx.font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  };
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

// -- Peer share link (no server). The record is packed into the link's #fragment, which
// browsers never send to the host, so the link needs no account or network call to create
// or read. It is not signed: anyone can edit a link, so it is a friendly note, not a proof.
// Exactly these keys leave the device, and only after the user's consent (see consent.js). --

const PEER_SCHEMA = 1;
export const PEER_KEYS = Object.freeze([
  "schema",
  "week",
  "nickname",
  "tracked_minutes",
  "consistency_score",
  "breaks_taken",
]);
const PEER_MAX_CHARS = 2000;
const NICKNAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,19}$/u;

/** A pseudonym of 1 to 20 letters, digits, spaces, dots, dashes or underscores, or null.
 *  "@" is not allowed, so an email address or handle cannot go in by accident. */
export function cleanNickname(input) {
  const v = String(input ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return NICKNAME.test(v) ? v : null;
}

const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

const PEER_MAX_MINUTES = 7 * 24 * 60;
const PEER_MAX_BREAKS = 1000;

/** The record for one week, or null when the nickname or score is invalid. Tracked minutes
 *  and breaks are capped at the limits a link accepts (a week has 10080 minutes), so a
 *  real total never makes the record fail. */
export function peerRecord({ nickname, week, tracked_s, score, breaks }) {
  const rec = {
    schema: PEER_SCHEMA,
    week,
    nickname: cleanNickname(nickname),
    tracked_minutes: Math.min(PEER_MAX_MINUTES, Math.round((Number.isFinite(tracked_s) ? tracked_s : 0) / 60)),
    consistency_score: score,
    breaks_taken: Number.isFinite(breaks) ? Math.min(PEER_MAX_BREAKS, breaks) : breaks,
  };
  return isPeerRecord(rec) ? rec : null;
}

/** True only for an object with exactly PEER_KEYS and in-range values. */
export function isPeerRecord(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const keys = Object.keys(r);
  if (keys.length !== PEER_KEYS.length || !PEER_KEYS.every((k) => keys.includes(k))) return false;
  return (
    r.schema === PEER_SCHEMA &&
    typeof r.week === "string" &&
    /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(r.week) &&
    typeof r.nickname === "string" &&
    cleanNickname(r.nickname) === r.nickname &&
    int(r.tracked_minutes, PEER_MAX_MINUTES) &&
    int(r.consistency_score, 100) &&
    int(r.breaks_taken, PEER_MAX_BREAKS)
  );
}

const toB64Url = (text) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (code) => {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** `baseUrl#peer=<code>`. Throws on an invalid record. */
export function peerLink(record, baseUrl) {
  if (!isPeerRecord(record)) throw new Error("Invalid share record");
  const u = new URL(baseUrl);
  u.search = "";
  u.hash = `peer=${toB64Url(JSON.stringify(PEER_KEYS.reduce((o, k) => Object.assign(o, { [k]: record[k] }), {})))}`;
  return u.href;
}

/** Read a pasted link, a "#peer=..." fragment or a bare code. Returns the record or null. */
export function readPeerLink(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > PEER_MAX_CHARS) return null;
  const m = /(?:^|[#&?])peer=([A-Za-z0-9_-]+)/.exec(raw);
  const code = m ? m[1] : /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  if (!code) return null;
  try {
    const rec = JSON.parse(fromB64Url(code));
    return isPeerRecord(rec) ? rec : null;
  } catch {
    return null;
  }
}

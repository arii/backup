// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// offline.js: pure helpers for the opt-in offline mode (no DOM, no service
// worker calls). app.js owns the registration and the buttons; sw.js owns the
// cache. tests/js/offline.test.mjs.

/** Each release gets its own cache, named CACHE_PREFIX + precache version (mirrors sw.js). */
export const CACHE_PREFIX = "posture-guard-";
export const cacheNameFor = (version) => CACHE_PREFIX + version;
/** Cache entry that records which precache version and file hashes are stored. */
export const META_URL = "./__offline-meta.json";

export const READY_TEXT =
  "Offline mode is ready. You can disconnect Wi-Fi now. Your video is never stored. " +
  "Links to the home page and the privacy page still need a network. " +
  "Close this tab and clear site data afterwards if you want to be sure nothing stays on this device.";

/** Human size, e.g. 25.3 MB. */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Precache urls that are not in the cache yet. `cachedUrls` are urls relative to the app folder. */
export function missingFiles(precache, cachedUrls) {
  const have = new Set(cachedUrls);
  return precache.files.filter((f) => !have.has(f.url)).map((f) => f.url);
}

/** All-or-nothing: ready only when every precache file is cached and the stored version matches. */
export function isOfflineReady(precache, cachedUrls, storedVersion) {
  return storedVersion === precache.version && missingFiles(precache, cachedUrls).length === 0;
}

/** Percent 0..100 of bytes downloaded, never reaching 100 until done is true. */
export function progressPercent(doneBytes, totalBytes, done = false) {
  if (done) return 100;
  if (!(totalBytes > 0)) return 0;
  return Math.max(0, Math.min(99, Math.floor((doneBytes / totalBytes) * 100)));
}

/**
 * Which state to show.
 * @param {{supported: boolean, registered: boolean, ready: boolean, downloading: boolean, error: boolean, stale: boolean}} f
 */
export function offlineState(f) {
  if (!f.supported) return "unsupported";
  if (f.downloading) return "downloading";
  if (f.error) return "error";
  if (f.ready) return "ready";
  if (f.registered && f.stale) return "update-available";
  return "idle";
}

/** Status line for a state. `info` may carry {percent, totalBytes}. */
export function offlineMessage(state, info = {}) {
  switch (state) {
    case "unsupported":
      return "Offline mode is not available in this browser. The app still works online as usual.";
    case "downloading":
      return `Downloading for offline use... ${info.percent ?? 0}%`;
    case "ready":
      return READY_TEXT;
    case "update-available":
      return "A newer version is available. Select Make available offline to update your offline copy.";
    case "error":
      return "The offline download did not finish, so offline mode is not on. Check your connection and try again.";
    default:
      return `Optional: download the app to this device${info.totalBytes ? ` (about ${formatSize(info.totalBytes)})` : ""} so it works without a network. Your video is never stored either way.`;
  }
}

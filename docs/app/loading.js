// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Start-up feedback for the webcam path. Getting from "Start with webcam" to
// tracking takes a camera prompt, a ~15 MB first-visit download and a model
// warm-up that can freeze the page for a few seconds. Without feedback that
// looks broken, so this shows each step with a progress bar, real byte
// counts and a hint when a step runs long.
//
// - downloadAll(): fetches files with byte-level progress. Expected sizes
//   come from precache.json (exact file sizes), because Content-Length is the
//   compressed size when the server gzips.
// - LoadSteps: drives the step list in index.html (#load-steps).

/** Expected byte sizes by absolute URL, from precache.json. Empty on failure. */
let sizesPromise = null;
function expectedSizes() {
  if (!sizesPromise) {
    const base = new URL("./", import.meta.url).href;
    sizesPromise = fetch(new URL("precache.json", base))
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => new Map((d.files || []).map((f) => [new URL(f.url, base).href, f.size])))
      .catch(() => new Map());
  }
  return sizesPromise;
}

/**
 * Fetch every URL, reporting combined progress as onProgress(received, total).
 * total is the sum of known sizes (precache.json, else Content-Length), or 0
 * when nothing is known. Resolves to the ArrayBuffers in URL order.
 * fetchImpl and sizes are injectable for tests.
 */
export async function downloadAll(urls, onProgress = () => {}, { fetchImpl = fetch, sizes = null } = {}) {
  const known = sizes || (await expectedSizes());
  const got = urls.map(() => 0);
  const want = urls.map((u) => known.get(u) || 0);
  const report = () => {
    const total = want.reduce((a, b) => a + b, 0);
    const received = got.reduce((a, b) => a + b, 0);
    onProgress(total ? Math.min(received, total) : received, total);
  };
  report();
  return Promise.all(
    urls.map(async (url, i) => {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`${url.split("/").pop()}: HTTP ${res.status}`);
      if (!want[i]) want[i] = Number(res.headers.get("content-length")) || 0;
      if (!res.body?.getReader) {
        const buf = await res.arrayBuffer();
        got[i] = buf.byteLength;
        want[i] = buf.byteLength;
        report();
        return buf;
      }
      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got[i] += value.byteLength;
        report();
      }
      const out = new Uint8Array(got[i]);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
      }
      want[i] = got[i]; // exact now, whatever the estimate was
      report();
      return out.buffer;
    }),
  );
}

export const mb = (bytes) => (bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1);

/** Hints shown when a step runs long, by step id. */
const SLOW_HINTS = {
  camera: "Look for the camera prompt near the address bar and choose Allow.",
  download: "Still downloading. On a slow connection the first visit can take a minute; after that it's cached.",
  start:
    "Still starting. The first start prepares the model for your graphics chip and can take a few seconds. " +
    "The page may pause briefly.",
};
const SLOW_AFTER_S = { camera: 8, download: 12, start: 6 };

/** Drives the #load-steps list: pending, active (spinner), done or failed. */
export class LoadSteps {
  constructor(doc = document) {
    this.doc = doc;
    this.root = doc.getElementById("load-steps");
    this.bar = doc.getElementById("load-bar");
    this.fill = doc.getElementById("load-fill");
    this.hint = doc.getElementById("load-hint");
    this.active = null;
    this.timer = null;
    this.labels = new Map(
      [...this.root.querySelectorAll("[data-step]")].map((li) => [
        li.dataset.step,
        li.querySelector(".load-label").textContent,
      ]),
    );
  }

  item(id) {
    return this.root.querySelector(`[data-step="${id}"]`);
  }

  setBusy(on) {
    const overlay = this.doc.getElementById("start-overlay");
    if (on) overlay.setAttribute("aria-busy", "true");
    else overlay.removeAttribute("aria-busy");
  }

  /** Show the list with every step pending and its default label. */
  open() {
    for (const li of this.root.querySelectorAll("[data-step]")) {
      li.className = "pending";
      li.querySelector(".load-detail").textContent = "";
      li.querySelector(".load-label").textContent = this.labels.get(li.dataset.step);
    }
    this.root.hidden = false;
    this.bar.hidden = true;
    this.hint.textContent = "";
    this.setBusy(true);
  }

  /** Mark the current step done and make `id` the active one. */
  step(id, detail = "") {
    if (this.active && this.active !== id) this.item(this.active).className = "done";
    this.active = id;
    const li = this.item(id);
    li.className = "active";
    li.querySelector(".load-detail").textContent = detail;
    this.bar.hidden = id !== "download";
    this.hint.textContent = "";
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.hint.textContent = SLOW_HINTS[id] || "";
      },
      (SLOW_AFTER_S[id] || 10) * 1000,
    );
  }

  /** Change a step's label (e.g. for the fallback model) without moving on. */
  label(id, text) {
    this.item(id).querySelector(".load-label").textContent = text;
  }

  progress(received, total) {
    const detail = this.item("download").querySelector(".load-detail");
    if (total > 0) {
      const pct = Math.round((100 * received) / total);
      this.fill.style.width = `${pct}%`;
      this.bar.setAttribute("aria-valuenow", String(pct));
      detail.textContent = `${mb(received)} of ${mb(total)} MB`;
    } else {
      detail.textContent = `${mb(received)} MB`;
    }
  }

  /** Done, or no longer relevant: hide the list. */
  finish() {
    clearTimeout(this.timer);
    this.active = null;
    this.root.hidden = true;
    this.bar.hidden = true;
    this.hint.textContent = "";
    this.setBusy(false);
  }

  /** Mark the active step failed and leave the list up, so it shows where. */
  fail() {
    clearTimeout(this.timer);
    if (this.active) this.item(this.active).className = "failed";
    this.active = null;
    this.bar.hidden = true;
    this.hint.textContent = "";
    this.setBusy(false);
  }
}

/** Resolve after the browser has painted, so status text shows before a long
 *  synchronous call (the MediaPipe warm-up blocks the main thread). */
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

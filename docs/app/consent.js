// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Opt-in consent for the features that read shoulder and face landmarks
// (breath check, "Breathe with me", breathing moments, shoulder-creep
// reminders). A dated record in the same localStorage store, so "Delete my
// data" removes it. Pure, tested in tests/js/consent.test.mjs. This is an
// engineering safeguard, not legal advice; see docs/legal-checklist.md.

export const CONSENT_VERSION = 1; // bump when the text below changes materially

export const CONSENT_TITLE = "Turn on shoulder and breathing features?";

export const CONSENT_POINTS = Object.freeze([
  "What is measured: the positions of your shoulders, neck and nose in the camera picture, to notice when your shoulders creep up and to time a breathing exercise.",
  "Where: only in this browser tab, on your computer. Nothing is uploaded or sent anywhere.",
  "What is kept: no video, images or landmark points are stored. Only simple counts and totals, such as how many reminders you had today, are saved in this browser.",
  "Never used to identify anyone: there is no face matching, no accounts and no profile of you.",
  "You can withdraw at any time under Breaks & prompts, and Delete my data removes this record.",
]);

export const CONSENT_CHECKBOX = "I agree to turn on these features.";

/** True when the stored consent is for the current text. */
export function hasConsent(store) {
  const c = store?.consent;
  return !!c && Number(c.version) >= CONSENT_VERSION && typeof c.at === "string" && !Number.isNaN(Date.parse(c.at));
}

/** Record opt-in with a timestamp. `now` is a Date or ms. */
export function recordConsent(store, now = Date.now()) {
  store.consent = { version: CONSENT_VERSION, at: new Date(now).toISOString() };
  return store;
}

/** Withdraw: the record is removed and the features stay off until consent is given again. */
export function withdrawConsent(store) {
  delete store.consent;
  return store;
}

/** One line for the settings panel. */
export function consentStatus(store) {
  return hasConsent(store)
    ? `Turned on ${store.consent.at.slice(0, 10)}. Shoulder and breathing features are available.`
    : "Off. Breath check, Breathe with me, breathing moments and shoulder reminders need your OK first.";
}

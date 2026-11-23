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
  return hasConsent(store) ? `On since ${store.consent.at.slice(0, 10)}.` : "Off. Needs your OK first.";
}

// -- Consent to share a weekly score by link (progress-review requirement 6.1). Separate
// from the landmark consent above. Off by default. The dialog lists the exact record. --

const SHARE_CONSENT_VERSION = 1;
export const SHARE_CONSENT_POINTS = Object.freeze([
  "What is shared: only the record shown below, when you press Create link. It holds a nickname you choose, the week, your tracked minutes, a consistency score and your breaks taken.",
  "No video, images, landmarks, minute-by-minute data, name, email or device identifier is included.",
  "How: the record is packed into a link that you copy and send yourself. There is no server and no account. Nothing is sent by this site.",
  "Once someone has the link, they keep it. You cannot take back a copy. Links can be edited by whoever holds them.",
  "You can switch this off any time under Your progress. That removes this record. Your local data stays.",
]);

/** True when sharing consent is recorded for the current text. */
export function hasShareConsent(store) {
  const c = store?.shareConsent;
  return (
    !!c && Number(c.version) >= SHARE_CONSENT_VERSION && typeof c.at === "string" && !Number.isNaN(Date.parse(c.at))
  );
}

export function recordShareConsent(store, now = Date.now()) {
  store.shareConsent = { version: SHARE_CONSENT_VERSION, at: new Date(now).toISOString() };
  return store;
}

/** Withdraw: the consent record and the saved nickname are removed. */
export function withdrawShareConsent(store) {
  delete store.shareConsent;
  delete store.shareNickname;
  return store;
}

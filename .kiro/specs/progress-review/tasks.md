# Implementation Plan: Progress Review and Leaderboard

Checked items are built. Task 11 is blocked on the owner and is not built.
There is no server and no health data leaves the device (issue #51). The peer share link
(task 9) is the only sharing built: it needs no server and sends nothing.

- [x] 1. `progress.js` aggregation
  - `summarize`, `exportJson`, `PROGRESS`. Tests: `tests/js/progress.test.mjs` (7-day window,
    null for sparse days, cumulative, test trend, `try_light`, bad input skipped).
  - _Requirements: 1, 3_
- [x] 2. "Your progress" panel
  - 7-day list, cumulative minutes, test trend vs coached, light-coaching suggestion, no
    streak-loss text.
  - _Requirements: 1_
- [x] 3. Export JSON and "Delete my data"
  - _Requirements: 2_
- [x] 4. `store.schema` and Import JSON
  - `readSchema`, `parseImport` (1 MB limit, finite non-negative numbers, real dates, whole-file
    reject), `previewImport`, `applyImport` (merge sums seconds and de-duplicates tests, replace),
    "Import JSON" with a preview dialog. Tests: `tests/js/progress-review.test.mjs`.
  - _Requirements: 4_
- [x] 5. Local-date day keys and migration
  - `migrateStore` writes `schema: 2` and `dayKeyCutover`, `dayKeyFor`, local-date `summarize`
    window (calendar-day steps, so DST cannot skip a date). Old UTC keys stay as they are.
  - _Requirements: 5.5_
- [x] 6. Daily relaxed-shoulders counters and trend
  - `BracingMonitor.relaxed`, `day.relaxed_s`, `day.brace_events`, `day.best`, `day.breaks` via
    `tallyDay`. Relaxed seconds count only with the shoulder and breathing consent. Panel shows
    the 7-day relaxed share. Tests: `relax.test.mjs`, `progress-review.test.mjs`.
  - _Requirements: 5.2, 5.3_
- [x] 7. Weekly view, per-day best run, coached vs silent chart
  - `summarizeWeeks` (ISO weeks, last 8), weekly rows with a coached bar and a silent bar,
    per-day "best run" text.
  - _Requirements: 5.1, 5.2, 5.4_
- [x] 8. Consistency score module with the 90% cap
  - `docs/app/consistency.js`, tests: `tests/js/consistency.test.mjs` (P7: 90 and 100 score the same,
    10 h per day cap, 5 active days cap).
  - _Requirements: 6.6, 6.7_
- [x] 9. Peer share link prototype, no server
  - `peerRecord`, `peerLink`, `readPeerLink` in `share.js`. Exactly six keys, packed in the `#`
    fragment, nickname with no `@`. Not signed: a link can be edited, and copies cannot be taken
    back (stated in the consent text and privacy notice). Per-install signing (7.2) is left out
    because it needs a server-issued token to mean anything. Tests: `tests/js/peer-share.test.mjs` (P8).
  - _Requirements: 6.1, 6.3, 6.4_
- [x] 10. Consent dialog and settings toggle
  - "Share my weekly score" toggle (off by default), dialog listing the exact record, nickname,
    checkbox, "Not now". The share section stays hidden until consent. Turning it off removes the
    consent record and nickname. `privacy.html#share-links` updated.
  - _Requirements: 6.1, 7.3_
- [ ] 11. Server option B: signed aggregate API, retention and delete endpoint
  - **Blocked, owner only. Not built and not faked.** It needs a hosted server, abuse handling and
    legal review first: issue #51 forbids sending health data to a server without it (opt-in
    biometric consent, derived scores only, retention statement, deletion). Counsel must also set
    the age limit for minors (requirement 6.10) and the 12-week retention (7.3), and the owner
    must pick a host. Until then the app has no network path for scores.
  - _Requirements: 6.5, 6.10, 7_

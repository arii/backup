# Design Document: Progress Review and Leaderboard

## Data already stored (`localStorage["posture-guard:v1"]`)
- `store.days[YYYY-MM-DD] = { good, bad }` seconds, key from `todayKey()` (UTC date).
  Coached time only. Silent-test and paused time are not added.
- `store.tests = [{ at: ISO, minutes, good, bad }]`, last 50, seconds, tracked >= 30 s.
- Settings (`mode`, `specificCues`, `spokenPraise`, ...), calibration, custom sounds.

## Modules
- `docs/app/progress.js` (FEAT-003): pure functions, unit-tested in
  `tests/js/progress.test.mjs`.
  ```js
  export const PROGRESS = Object.freeze({ min_tracked_s: 60, window_days: 7, max_tests: 10 });
  export function summarize(store, now) // -> { days:[{date, tracked_s, good_s, pct|null}], cumulative_good_s,
                                        //      tests:[{at, pct, minutes}], coached_pct_7d|null,
                                        //      try_light:boolean, empty:boolean }
  export function exportJson(store)     // -> string, whitelisted keys only
  ```
- `docs/app/app.js` renders the panel, handles the download and "Delete my data".
- Social phase (spec only): `docs/app/share.js`, plus an optional server. None in FEAT-003.

## Personal review (FEAT-003)
```
store.days, store.tests ──> summarize(store, now) ──> panel
                                                   ├─ 7-day list (pct or "no data")
                                                   ├─ cumulative good minutes
                                                   ├─ silent-test trend vs coached %
                                                   └─ "You could try light coaching"
```
- Day pct = `round(100 * good / (good + bad))`, null when `good + bad < min_tracked_s`.
- Coached 7-day pct is the sum over days with data. `try_light` is true when there is at
  least one test and `latest_test.pct >= coached_pct_7d` and coached data covers at least
  2 days. It is a suggestion only.
- No streak counter appears in the panel. "Best streak" stays a within-session stat.
- Empty state: "Nothing tracked yet. Your progress will appear after your first session."
- Export whitelist: `schema`, `days`, `tests`, `exportedAt`. Excludes sounds, calibration.
- Delete: `localStorage.removeItem("posture-guard:v1")`, then reset in-memory `store`.

## Schema versioning (spec only for the field, FEAT-003 tolerates it)
`store.schema` integer. Version 1 is the shape above. Readers ignore unknown fields.
Moving day keys to local dates is a version 2 migration. Converting old UTC keys is
lossy (a day's seconds cannot be re-split), so keep old keys as they are, write local
dates from the cut-over, and record the cut-over date in `store.dayKeyCutover`.

## Import (spec only)
Parse, check size, validate each day and test, preview totals, merge or replace, save.
Merge sums `good` and `bad` per date and appends tests by `at`, de-duplicated.

## Social leaderboard (spec only)
### Consistency score
For a week of 7 days:
```
days_active   = number of days with >= 20 tracked minutes          (cap 5)
good_band     = min(good_pct, 90) / 90                              (ceiling: rigid posture not rewarded)
relax_band    = relaxed_s / tracked_s                               (needs day.relaxed_s)
breaks        = min(breaks_taken, 3 * days_active) / (3 * days_active)
consistency   = 100 * (0.35*days_active/5 + 0.25*good_band + 0.2*relax_band + 0.2*breaks)
```
Weights are a starting point to tune with user feedback. They are deliberately not
dominated by good %.

### Anti-gaming
| Risk | Mitigation |
|---|---|
| Sit rigidly for a high %. | Good % capped at 90 in the formula. Relaxed-shoulder and break terms. |
| Hide from camera or leave it open empty. | Only tracked time counts. A cap on tracked minutes per day (for example 10 h). Presence is already required to produce a pose. |
| Forge a score. | Signed payload with a per-install token. Server rate limits one record per week per token. Accept that a determined cheater can fake numbers: the board is friendly, not competitive. |
| Obsess over rank. | Small groups only. Own trend is the default view. No loss framing. |

### Backend options
| Option | How | Pros | Cons |
|---|---|---|---|
| A. None (personal only) | Everything local. | Zero privacy risk, no hosting, no legal surface. | No social comparison. |
| B. Signed aggregate to a small API | Client posts the aggregate record over HTTPS. Server stores nickname, week, three numbers. | Real shared boards, simple, small data. | Needs hosting, abuse handling, retention policy, and a privacy policy. Legal review for minors and for GDPR-style rights. |
| C. Peer share links | User exports a signed aggregate as a link or QR and friends paste it. No server. | No server, no accounts, strongest privacy. | Manual, no live ranking, easy to forge, no deletion of copies. |

Recommendation: ship A (this branch). If demand exists, prototype C first (no server),
then B for groups that ask for live boards.

### Consent flow
Settings toggle -> dialog listing the exact JSON that would be sent, nickname field,
retention, how to delete -> "Share" and "Not now" -> preview of the current week's
record before every submission (or an explicit "send automatically each week" choice).

## Correctness properties
- **P1 no data, no number**: a day with tracked time under `min_tracked_s` yields `pct = null`.
- **P2 bounded**: every pct is in [0, 100]. `summarize` never throws on missing, partial
  or non-finite stored values; it skips them.
- **P3 no network**: `summarize`, export and delete never call `fetch` or open a socket.
- **P4 whitelist**: `exportJson` output contains only whitelisted keys.
- **P5 monotonic cumulative**: cumulative good seconds equal the sum of `days[*].good`
  for finite values and never decrease when a day is added.
- **P6 suggestion is advisory**: `try_light` never mutates settings.
- **P7 (spec only) cap**: consistency score is the same for good % 90 and good % 100 with
  the other inputs fixed.
- **P8 (spec only) minimal payload**: the share payload has exactly the documented keys.

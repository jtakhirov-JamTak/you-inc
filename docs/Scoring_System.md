# You, Inc. — Scoring System

> **Status:** current as of `SCORING_VERSION = 4` (the 2026-06-29 RPG redesign + the
> daily-streak asset scaling / vice-collapse haircut) under the **projection model**
> (migrations 0027–0030). The scoring *math* is unchanged from v4; what changed is how
> the value is stored and re-derived — see §8.
> **Source of truth:** the code, not this doc. Every constant lives in
> `src/lib/price/config.ts`; the math lives in `src/lib/price/engine.ts`,
> `weeks.ts`, `settlement.ts`, and `statements.ts`. If a number here disagrees with
> `config.ts`, `config.ts` wins — update this doc.
>
> The numbers are **tuning knobs**, explicitly marked "unvalidated, will be tuned
> after the concierge test." Changing any value is a one-line edit in `config.ts`
> **plus a `SCORING_VERSION` bump**. Under the projection model a bump is a **replay**
> (recompute + replace from frozen facts), **not** a reset to baseline — value
> re-derives from real history and nobody drops to $200k (see §8).

---

## 0. Foundations

- **Operating value** = **$200,000 baseline + Σ(every `price_ledger` row)**.
  Server-authoritative, deterministic, replayable. The client never computes it.
- **Facts vs. valuation (the projection model, §8).** History is stored as **frozen
  facts** — an immutable per-week snapshot (`settled_weeks`) and a realized sprint
  outcome (`sprint_closes`). The `price_ledger` is a **rebuildable projection** of
  those facts under the current constants — never the source of truth.
- **Two denominators:**
  - Habits, streaks, recovery, collapse → **% of the fixed $200,000** (so 1% = $2,000).
  - Sprint payoffs → **% of the balance frozen when the sprint was created**
    (`set_time_balance_cents`), NOT the baseline.
- **Weeks** are 7-day weeks anchored to the user's `week_start`, in the **user's
  timezone**. A **complete** week (past its grace window, §8) freezes into a
  `settled_weeks` fact and projects into permanent ledger rows. The **in-progress
  week** shows as a live "provisional mark" that is never booked until it closes. A
  just-closed week inside its **grace day** shows provisionally too, still editable.

---

## 1. The roster (4 positions)

| Position | Count | Streak category | Cadence |
|---|---|---|---|
| Morning, Evening, Mission | 3 assets | **`daily`** | per-day |
| Vice | 1 liability | **`vices`** | per-day |

Everything scores per-day — the old weekly cadence/recurrence is gone.

---

## 2. Per-day contribution — booked every week (`habit_week_settled`)

Each position earns/loses a % of the $200k baseline:

| | Per good day | Per bad day | Weekly cap (+ / −) |
|---|---|---|---|
| **Daily asset** (each) | +0.25% done | −0.25% missed | +1.75% / −1.75% |
| **Vice** | +0.25% clean | −0.5% slip | +1.75% / −3.5% |

- A daily **miss** = an elapsed day with no `done` log. A vice **slip** = the
  *inferred* absence of a "clean/paid" (`done`) log on an elapsed day. Vices are
  **affirmative-only**: you only ever log the positive; slips are inferred — and they
  **do** carry the −0.5%.
- **"Negative only at midnight":** today, un-done is *neutral* (0), never a miss,
  until the day fully elapses.
- **Whole-week envelope:**
  - Perfect = `1.75×3 + 1.75 = +7.0%` → **+$14,000**
  - Worst = `−1.75×3 + −3.5 = −8.75%` → **−$17,500**
  - A slack guard (`WEEK_MAX`) clamps a non-standard roster at **+11% / −14.5%**; it
    never binds with the standard 4-position roster.
- Signup week and mid-week-created habits score **pro-rata** (only the days they
  existed) — they earn the per-day ± from creation, never charged for days before.
- A week in which **no habit existed yet** books **nothing** (no $0 row) — an empty
  roster has nothing to settle, and no `settled_weeks` fact is frozen for it.

---

## 3. Streak bonuses — per category, on top of the contribution

Tracked **independently** for `daily` (all 3 assets perfect) and `vices` (the vice
perfect), so both can pay in the same week. A category is **full** for a week only if
every *scheduled* position was perfect **and** it was a complete week joined at the
week start. Consecutive full weeks pay (% of baseline), front-loaded and deliberately
**non-monotonic** (this is the **base** bonus, before the modifiers below):

| Week in streak | 1 | 2 | 3–4 | 5–6 | 7–10 | 11–12 | 13–14 | 15–16 | 17+ |
|---|---|---|---|---|---|---|---|---|---|
| Base bonus % | 1.0 | 1.5 | 3.0 | 4.5 | 2.5 | 4.5 | 6.0 | 4.5 | 3.0 |

- A **partial week**, a **"nothing scheduled"** week, or an **"absent"** category
  (you don't hold that habit yet) **freezes** the run — no extend, no break, no bonus.
- "Absent" never counts as a miss (so a later first run earns the *streak* ramp, not
  the higher recovery ramp).

**Two modifiers apply to the bonus** (the streak *run-length* itself is never
modified — only the booked %):

1. **Active-asset scaling (daily only).** The daily bonus is multiplied by
   **`active_daily_assets / 3`** — so a partial roster earns proportionally less:

   | Active daily assets | Multiplier |
   |---|---|
   | 1 | ⅓ (33%) |
   | 2 | ⅔ (67%) |
   | 3 | 1 (100%) |

   The single-position `vices` bonus is **not** scaled.

2. **Vice-collapse haircut.** If the vice **slips every day** of the week (a vice
   collapse, §5), a **×0.5 haircut** applies to **all** streak/recovery bonuses booked
   that week. In practice that's the daily bonus, since the `vices` category can't be
   "full" while it's collapsing.

   > Effective daily bonus = `base × (active_assets / 3) × (vice_collapsed ? 0.5 : 1)`.
   > Both modifiers are recorded in the ledger row's metadata
   > (`activeAssets`, `vicesHaircut`).

---

## 4. Recovery bonuses — after a real miss

Once a category has a genuine **broken** week (a scheduled position failed), its next
full-week runs use the **recovery ramp** instead of the streak ramp:

| Week in recovery | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|
| Base bonus % | 1.0 | 2.0 | 3.0 | 4.0 | 5.0 | 6.0 | → falls back to the streak ramp |

- Only a real *broken* week arms recovery — an absent/skipped/partial one does not.
- The **same two modifiers from §3 apply** — the daily recovery bonus is scaled by
  `active_assets / 3`, and a vice collapse halves it.

---

## 5. Collapse penalties — two independent, **stacking**

| Penalty | Trigger | Wk 1 / 2 / 3+ |
|---|---|---|
| **Vices collapse** | The vice slipped **every** day of a complete week | −1.0 / −2.0 / −3.0 |
| **Total collapse** | A vices-collapse week that is **also** zero on every scheduled asset | −2.5 / −3.5 / −5.0 |

- Both can fire the same week and **add** (a total-collapse week books both rows).
- Gated on the **complete** vice category (≥1 vice present) — a mid-setup roster with
  0 vices never collapses. Partial weeks are shielded.
- **A vices collapse also halves every streak/recovery bonus that week** (the §3
  haircut) — so a week where you nail your assets but blow the vice gets both the
  collapse penalty *and* a 50%-reduced asset bonus.

---

## 6. Sprints (investments) — frozen-balance denominator

10–14 day pushes, sized **small / medium / big**, each targeting a domain
(Health / Wealth / Relationships). Payoff = **% of the balance frozen at creation**.
Band by completion ratio (done ÷ total tasks):

| Completion | small | medium | big |
|---|---|---|---|
| 0% | −7 | −10 | −14 |
| 1–20% | −5.5 | −8 | −12 |
| 21–40% | −3.5 | −5 | −7 |
| 41–50% | 0 | 0 | 0 |
| 51–70% | +1 | +1.5 | +2 |
| 71–85% | +3.5 | +5 | +7 |
| 86–99% | +5.5 | +8 | +12 |
| 100% | +7 | +10 | +14 |

- **Goal-achieved bonus** (upside-only, added on top): small **+3**, medium **+5**,
  big **+6**.
- **Live unrealized mark** while active: each task = an equal `1/total` slice of the
  full ±band — a done task adds its slice; a task whose milestone day passed undone
  subtracts its slice; not-yet-due = 0. Starts at 0 on day 1, converges to the extreme
  as milestones resolve (the goal bonus is excluded until close).
- The big-bet gate (`BIG_BET_GATE_ENABLED`) is **off** in v0.
- **Sprints are the deliberate opposite of habit weeks (§8).** A closed sprint is a
  *realized event* — its dollar **outcome** is frozen in `sprint_closes` and re-emitted
  **verbatim** on replay. Tuning a constant never retro-changes a 6-month-old payoff.
  (Habit weeks freeze their *inputs* and re-tune the output; sprints freeze the output.)

---

## 7. Roll-up to the operating value & the RPG regions

Each settled week books: **1** `habit_week_settled` + up to **2** streak/recovery
rows (one per category) + up to **2** collapse rows; plus `sprint_realized` rows when
a sprint closes. Then:

- **Operating value** = $200k + Σ(all ledger rows).
- **Regions (Home map)** = per-area cumulative contribution, computed
  server-side in `getOperatingState` and returned as `regionLevels`:
  - Habit contributions split by each habit's **area** (Health / Wealth /
    Relationships; untagged → `operations`).
  - **Sprint payoffs bucket into their target region** — both the settled payoff and
    the active sprint's live unrealized return move that region.
  - **Streak / recovery / collapse bonuses → `operations`** (they are per
    behavior-category and cross-domain — a `daily` streak spans Morning + Evening +
    Mission across different areas — so they move the total $ but not a single
    region's level).
  - Level pacing: **$1,000 of cumulative area contribution per level** (`LEVEL_STEP`,
    display only — the dollars are authoritative).
  - Provisional (current week + active-sprint unrealized) is added live on top.

---

## 8. The projection model — facts, valuation, replay & safety rails

The core split (migrations 0027–0030). It exists to resolve one contradiction: the
constants are *meant* to be tuned after the concierge test, but tuning needs a
`SCORING_VERSION` bump — and under the old "permanent ledger" design a bump forced a
per-user wipe back to $200k, destroying the accumulated value that *is* the product's
hook. The fix: separate **facts** (immutable) from **valuation** (rebuildable).

### Facts — frozen, append-only

- **`settled_weeks`** — a **write-once** per-week snapshot of the bucketed
  `PositionWeekInput[]` (roster membership, each habit's area, the tz/`week_start`
  bucketing, and the day counts). It freezes **every mutable input** to the week math,
  because the live `habits` row changes (retiring flips `status`; area/title/timezone
  are editable). Replay reads the snapshot, **never** the live roster.
- **`sprint_closes`** — the realized sprint **outcome** (dollars, %, band, area, close
  date). Version-stable; re-emitted verbatim.
- Raw `habit_logs` remain the deepest archive: a change to the *bucketing rule* would
  rebuild snapshots from them as a deliberate migration; a routine constant tune does not.

### Valuation — a projection (freely rebuildable)

- **`price_ledger`** (habit-week family + `sprint_realized`) is a pure function of the
  facts + current constants.
- A `SCORING_VERSION` bump is a **REPLAY** — recompute + replace, **not** a reset.
  `settleUser` rebuilds when a new fact was just frozen **or** the version guard
  detects an older-version ledger row (the old "throw on mismatch" is now the replay
  trigger). Value re-derives from real history; nobody drops to baseline.
- The rebuild is **atomic** via the `replay_user_projection` RPC (delete + reinsert in
  one plpgsql transaction — the JS client can't do interactive transactions — so a
  mid-replay crash can't leave a mixed-version ledger).
- **`board_meetings` is UPDATED IN PLACE, never deleted** — it's a hybrid row: derived
  columns beside the user `note`, AI `analysis_*`, and FK-cascading `board_resolutions`.
- Replay invariants (pinned in `price/__tests__/replay.test.ts`): determinism,
  path-independence A→B→A (no hysteresis), and tuning-bites.

### The grace window

- `SETTLEMENT_GRACE_DAYS = 1` (`config.ts`). Absence-of-log is an *inferred* miss/slip,
  so a calendar week is **not** settled the instant it ends — it settles the day
  **after** (a Sunday-ending week settles Tuesday 00:00 local). The grace day lets the
  user fix the just-closed week (forgot to log, travel, sickness, late entry) before
  the score locks. Home shows last week live-and-editable beside the new week
  ("Option B"), via the `PendingSettlement` card + `state.pendingSettlement`.
- Settlement is **lazy** (next load at/after the boundary), not a cron.
- The grace window does **not** cover a multi-day outage — a true "skip/pause week" is
  a separate future feature.

### Safety rails

- `price_ledger` is idempotent-by-key `(user_id, settlement_key)`; `board_meetings` by
  `week_index`.
- The freeze **trigger** (migration 0011, re-based onto `settled_weeks` in 0029) rejects
  `habit_logs` writes inside any **frozen** week's date range — the API maps the
  rejection to a 409. It keys off `settled_weeks` (write-once), **not** the ledger
  (which is deleted+reinserted on every replay), so history never transiently unlocks
  mid-rebuild.
- Every read in `settleUser` / `getOperatingState` is checked for `.error` **before**
  any settle — a partial read must surface "unavailable", never book from a wrong view.

### Read-path bounding (perf)

- Settlement latency is bounded to a **trailing window**, so it does not grow with
  account age. `settleUser` short-circuits on the common load (no new week + no version
  gap) after only small reads, skipping the volume reads and the replay RPC entirely;
  when it does run, `habit_logs` is read `>= cutoff` and `buildWeeks` materializes only
  weeks at/after the latest frozen week. Older weeks replay from their snapshots.
  `getOperatingState` bounds its repeated `buildWeeks` calls the same way. The
  persisted ledger is unchanged — replay still folds the full frozen-fact set.

---

## 9. Where each piece lives

| Concern | File |
|---|---|
| All constants (the tuning knobs) | `src/lib/price/config.ts` |
| Pure math (per-position %, bonuses, sprint payoff, money helpers) | `src/lib/price/engine.ts` |
| Bucketing logs → weeks (per-day done/miss/slip, pro-rata, today-split, window cutoff) | `src/lib/price/weeks.ts` |
| The fold (streak/recovery/collapse run-tracking → ledger drafts) | `src/lib/price/settlement.ts` |
| Weekly statements + per-area split (regions) | `src/lib/price/statements.ts` |
| DB-aware runner (freeze facts, rebuild the projection, regions, version replay) | `src/lib/price/runner.ts` |
| Sprint close → frozen outcome + realized payoff booking | `src/lib/price/sprint-runner.ts` |
| Frozen per-week snapshot fact | `settled_weeks` (migration 0027) |
| Frozen sprint outcome fact | `sprint_closes` (migration 0028) |
| Atomic replay (delete + reinsert in one tx) | `replay_user_projection` RPC (migration 0030) |
| Force-replay all users after a version bump | `POST /api/admin/recompute` (secret-gated) |

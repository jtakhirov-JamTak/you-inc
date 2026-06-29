# You, Inc. — Scoring System

> **Status:** current as of `SCORING_VERSION = 3` (the 2026-06-29 RPG redesign).
> **Source of truth:** the code, not this doc. Every constant lives in
> `src/lib/price/config.ts`; the math lives in `src/lib/price/engine.ts`,
> `weeks.ts`, `settlement.ts`, and `statements.ts`. If a number here disagrees with
> `config.ts`, `config.ts` wins — update this doc.
>
> The numbers are **tuning knobs**, explicitly marked "unvalidated, will be tuned
> after the concierge test." Changing any value is a one-line edit in `config.ts`
> **plus a `SCORING_VERSION` bump** — which the settlement version-guard now requires
> a clean ledger reset for (see §8).

---

## 0. Foundations

- **Operating value** = **$200,000 baseline + Σ(every `price_ledger` row)**.
  Server-authoritative, deterministic, replayable. The client never computes it.
- **Two denominators:**
  - Habits, streaks, recovery, collapse → **% of the fixed $200,000** (so 1% = $2,000).
  - Sprint payoffs → **% of the balance frozen when the sprint was created**
    (`set_time_balance_cents`), NOT the baseline.
- **Weeks** are Mon→Sun (the user's `week_start`), in the **user's timezone**. Only
  **complete** weeks settle into permanent ledger rows. The **in-progress week**
  shows as a live "provisional mark" that is never booked until it closes.

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

---

## 3. Streak bonuses — per category, on top of the contribution

Tracked **independently** for `daily` (all 3 assets perfect) and `vices` (the vice
perfect), so both can pay in the same week. A category is **full** for a week only if
every *scheduled* position was perfect **and** it was a complete Mon→Sun week.
Consecutive full weeks pay (% of baseline), front-loaded and deliberately
**non-monotonic**:

| Week in streak | 1 | 2 | 3–4 | 5–6 | 7–10 | 11–12 | 13–14 | 15–16 | 17+ |
|---|---|---|---|---|---|---|---|---|---|
| Bonus % | 1.0 | 1.5 | 3.0 | 4.5 | 2.5 | 4.5 | 6.0 | 4.5 | 3.0 |

- A **partial week**, a **"nothing scheduled"** week, or an **"absent"** category
  (you don't hold that habit yet) **freezes** the run — no extend, no break, no bonus.
- "Absent" never counts as a miss (so a later first run earns the *streak* ramp, not
  the higher recovery ramp).

> **Open product question (#2, undecided):** today a 1- or 2-asset roster still earns
> the full `daily` streak bonus on what's present. Should the bonus require the
> **complete** 3-asset roster, the way the collapse *penalty* (§5) requires the
> complete category? One-line change in `settlement.ts` if so.

---

## 4. Recovery bonuses — after a real miss

Once a category has a genuine **broken** week (a scheduled position failed), its next
full-week runs use the **recovery ramp** instead of the streak ramp:

| Week in recovery | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|
| Bonus % | 1.0 | 2.0 | 3.0 | 4.0 | 5.0 | 6.0 | → falls back to the streak ramp |

Only a real *broken* week arms recovery — an absent/skipped/partial one does not.

---

## 5. Collapse penalties — two independent, **stacking**

| Penalty | Trigger | Wk 1 / 2 / 3+ |
|---|---|---|
| **Vices collapse** | The vice slipped **every** day of a complete week | −1.0 / −2.0 / −3.0 |
| **Total collapse** | A vices-collapse week that is **also** zero on every scheduled asset | −2.5 / −3.5 / −5.0 |

- Both can fire the same week and **add** (a total-collapse week books both rows).
- Gated on the **complete** vice category (≥1 vice present) — a mid-setup roster with
  0 vices never collapses. Partial weeks are shielded.

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

---

## 7. Roll-up to the operating value & the RPG regions

Each settled week books: **1** `habit_week_settled` + up to **2** streak/recovery
rows (one per category) + up to **2** collapse rows; plus `sprint_realized` rows when
a sprint closes. Then:

- **Operating value** = $200k + Σ(all ledger rows).
- **Regions (Home map)** = per-area cumulative contribution:
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

## 8. Irreversibility & safety rails

- `price_ledger` is **idempotent-by-key** `(user_id, settlement_key)` — the **first
  settlement of a week is permanent**. `board_meetings` is likewise idempotent by
  `week_index`.
- A DB trigger (migration 0011) **freezes `habit_logs`** writes inside any settled
  week's date range (the API maps the rejection to a 409).
- **Version guard:** `settleUser` refuses to book if the ledger holds any
  habit-settlement row from an older `SCORING_VERSION`, rather than silently mixing
  two scoring regimes. Bumping the version therefore requires a deliberate per-user
  ledger reset.

---

## 9. Where each piece lives

| Concern | File |
|---|---|
| All constants (the tuning knobs) | `src/lib/price/config.ts` |
| Pure math (per-position %, bonuses, sprint payoff, money helpers) | `src/lib/price/engine.ts` |
| Bucketing logs → weeks (per-day done/miss/slip, pro-rata, today-split) | `src/lib/price/weeks.ts` |
| The fold (streak/recovery/collapse run-tracking → ledger drafts) | `src/lib/price/settlement.ts` |
| Weekly statements + per-area split (regions) | `src/lib/price/statements.ts` |
| DB-aware runner (settles weeks, books the ledger, version guard) | `src/lib/price/runner.ts` |
| Sprint close → realized payoff booking | `src/lib/price/sprint-runner.ts` |

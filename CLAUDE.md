# CLAUDE.md

## Project Overview

You, Inc. — a self-development app where the user runs themselves like a company (PWA).
Operating health is a server-derived "price" starting at $200,000 (NOT self-worth). As of
the 2026-06-29 RPG redesign, Home PRESENTS that number as an **RPG map of 3 regions**
(Health/Wealth/Relationships that level up) rather than a stock chart — but the underlying
deterministic price engine is unchanged and still authoritative.

Product areas (post-redesign):
- **Mission** (the `/identity` route, tab labelled "Mission") — the charter: Mission statement
  (with Brand nested inside) + Values ("how you execute it") + Mantra (motivation). The
  **Mission habit** is created here.
- **Sprints** ("Strategy" tab) — 10–14 day pushes, authored via a guided visualization
  (Domain → Future Scene → behavior/tasks → Obstacle). The 1-year goal was REMOVED in the
  redesign; the visualization that drove it now drives sprint creation.
- **Habits** — fixed 4-position roster: **1 Morning + 1 Evening + 1 Mission asset (all
  per-day) + 1 Vice to remove**. (Was: 2 vices + morning/daily/weekly assets.) Setup lives on
  the "Systems" tab; daily check-ins happen on Home; the Mission habit is authored on Mission.
- **Regulation** — splits roadblock (cognitive → decision/time matrix) from trigger (emotional → stillness, containment); rule: regulate first, then decide
- **Weekly board meeting** — Sunday review of what moved the price
- **Journaling** — handwritten, off the app (morning planning, night reflection)

Tabs: Home · Mission · Strategy · Systems (Board lives in the avatar menu).

Solo founder, non-technical — explain in plain language, wait for approval before changing code.

## Foundation provenance

This repo was extracted as a clean foundation from a prior app (Pure EQ). What carried over: auth, Supabase client/server/service wiring, Sentry (with PII scrubber), rate limiting, origin checks, RLS discipline, the app shell + UI atoms, and the Engineering Playbook. All product domain was stripped. `0001` creates only `user_profiles`. (Voice/Whisper input was carried over but later removed — the app is text-only.)

**Phase B (not yet built):** the domain tables (identity, year goals, sprints, habits, habit/vice logs, weekly reviews) and the **score/price engine** (`score_events` → weekly snapshot → the home "price"). The price engine is the novel core — design it deliberately: deterministic, server-authoritative, versioned. Don't let the client compute the authoritative number.

## Commands

| Task              | Command                                       |
|-------------------|-----------------------------------------------|
| Dev server        | `npm run dev`                                 |
| Build             | `npm run build`                               |
| Type check        | `npx tsc --noEmit`                            |
| Lint              | `npm run lint`                                |
| Tests (unit)      | `npm test`                                     |
| Regen DB types    | `npm run db:types`                            |

Environment: requires `.env.local` with Supabase keys (see `.env.example`). The Supabase `db:types` script has a `YOUR_PROJECT_REF` placeholder — fill it in once the project exists.

## Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS (cream/ink design system in `globals.css` — the finalized handoff in `docs/You, Inc. App Design/`)
- **Backend:** Next.js API routes (server-side)
- **DB:** Supabase (PostgreSQL + Row-Level Security)
- **Auth:** Supabase Auth (email/password + Google OAuth)
- **AI (Phase B):** Anthropic Claude API
- **Validation:** Zod on every endpoint and AI output
- **Observability:** Sentry (custom PII scrubber in `sentry-scrub.ts`)

## Routing

- `src/app/(auth)/{login,signup}` — public auth pages
- `src/app/(app)/layout.tsx` — auth gate for authenticated pages; `(app)/{home,me,settings}` live under it
- `/` — public landing; authenticated users redirect to `/home`
- `middleware.ts` — session refresh + auth gate. Public routes: `/`, `/login`, `/signup`, `/privacy`, `/terms`, `/api/auth/*`

## Adding an API Endpoint

1. Zod schema → `src/lib/validation.ts`
2. Route handler → `src/app/api/{domain}/route.ts`
3. Origin check (`checkOrigin`), then auth (`createClient()` + `supabase.auth.getUser()`, 401 if no user)
4. Always filter by the userId from auth — never trust a client-provided userId
5. Rate-limit (`rateLimit`) AI/auth/enumeration endpoints; validate input with Zod
6. Validate any AI output against a schema + `BANNED_PHRASES` before displaying

## Adding a Table (migration)

1. New file `supabase/migrations/000N_*.sql` (next number after the highest)
2. `user_id uuid not null references auth.users(id) on delete cascade` so account-delete cascades
3. `enable row level security` + per-row policies `using (auth.uid() = user_id)` — never `using (true)`
4. End the migration with `notify pgrst, 'reload schema';`
5. Apply, then `npm run db:types` to regenerate `src/types/database.ts`

### Log tables (anything recording a user *action* — completions, slips, check-ins, reviews)

These are append-only Layer-1 records (Playbook §9 raw+derived) — the source of truth analytics/AI read later. Every such table also gets:

- **Append-only — never UPDATE/DELETE.** Grant only SELECT + INSERT policies; omitting UPDATE/DELETE policies makes RLS deny them. Corrections are a new row (or a future `voided_at`), never an in-place edit. Account-delete still erases via the `auth.users` cascade.
- **Two timestamps:** `occurred_at timestamptz not null default now()` (when it happened in the real world — what analytics group by; settable to a past time for backfill) **and** `recorded_at timestamptz not null default now()` (immutable server insert time, never a client clock).
- **Capture the timezone at write time** — `occurred_tz text` (IANA name from the client's `Intl.DateTimeFormat().resolvedOptions().timeZone`). `timestamptz` forgets the zone, so "what time of day" is unanswerable later without it. This can't be backfilled. (Pre-bucketed local hour/day columns are a speed optimization — defer; derive from `occurred_at` + `occurred_tz` on read.)
- **Idempotency:** `source_session_id uuid not null` + `unique (user_id, source_session_id)`; client mints one UUID per submission (`useRef`) and resends on retry (Playbook §16.1).
- **`metadata jsonb not null default '{}'`** for cheap extras + a frozen snapshot of the parent entity's then-current name/cadence, so history stays correct after a habit is renamed. Keep it small; load-bearing fields graduate to typed columns.
- **No generic `activity_events` table.** Use per-domain typed logs; a unified read is a `UNION ALL` view later if ever needed.

## Do's

- Before committing: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build` must pass
- Explain briefly what you're doing and why before making changes
- Use Zod validation on every API endpoint and every AI output
- Use Supabase RLS — every user table with `USING (auth.uid() = user_id)`
- Structured JSON from all AI calls — never free-form prose as the primary output
- Read `docs/Engineering_Playbook.txt` first — universal patterns (validation, auth, rate limit, idempotency, raw+derived, stale closures, fetch `res.ok`, etc.) live there

## Don'ts

- Don't rabbit-hole — if a fix fails after 2–3 attempts, stop and reassess
- Don't over-engineer — ship v0 first, iterate
- Don't skip Zod validation on any endpoint
- Don't use `USING (true)` on any RLS policy
- Don't log user content in error messages
- Don't trust a client-provided userId — always extract from Supabase auth
- Don't let the client compute the authoritative price/score — derive it server-side
- Gate any `/dev/*` routes with `if (process.env.NODE_ENV === "production") notFound();`

## Security Rules

- All API routes: origin check + auth check + userId filtering
- RLS enabled on every table with user data
- AI/API keys server-side only — never in client code
- Never read `.env.local` / `.env*` — edit `.env.example` instead and hand the founder lines to paste
- User free-text is untrusted in AI prompts — delimit from instructions
- Rate-limit AI, auth, and enumeration endpoints
- Never log response bodies or user content
- Any unauthenticated server-to-server webhook receiver MUST be added to `middleware.ts`'s public-route allowlist in the same change that adds the route

## Lessons Learned

(Project-specific lessons go here as they accrue. Universal patterns belong in `docs/Engineering_Playbook.txt`.)

- Domain log tables are append-only and immutable; the price engine derives from them **one-directionally** (logs → `score_events` → price), server-side only. The logs never read or depend on `score_events`, so a scoring change is fixed by re-deriving from the logs — the dependency arrow is never reversed.
- **⚠ SUPERSEDED by the "projection model" lesson at the end of this section.** The ledger is no longer permanent — it is a rebuildable projection of frozen facts, and the freeze trigger now keys off `settled_weeks` (migration 0029), not the ledger. (Historical, still true in spirit:) `price_ledger` *was* idempotent-by-key, so the first settlement of a week was permanent; never book from a failed/partial DB read (check `.error` on every read *before* settling — STILL TRUE). The original migration 0011 trigger rejected `habit_logs` writes whose `local_date` fell in `[weekEnd-6, weekEnd]` of any `habit_week_settled` ledger row; `/api/habits/log` maps the trigger's `settled_week_locked` message to a 409 (STILL TRUE — only the trigger's *source* moved to `settled_weeks`).
- **Keep pure logic out of `server-only` modules so it stays unit-testable.** Adding `import 'server-only'` makes Vitest fail to import the whole module (it resolves to the throwing client variant). Pattern: pure functions in a plain module (e.g. `price/weeks.ts`), the `server-only` marker only on the thin I/O shell that touches the service-role client (`price/runner.ts`). To unit-test the shell anyway, `vi.mock('server-only', () => ({}))` + a fake `createServiceClient` (see `price/__tests__/runner.test.ts`).
- **Any predicate that books an irreversible ledger row must be robust to an INCOMPLETE roster.** The habit-creation gate caps the *maximum* (≤2 vices, ≤1 of each cadence), never the minimum — a setup-in-progress roster (e.g. 1 vice) is valid and still gets settled. So `isVicesCollapse` must gate on the COMPLETE vice set, not "any present vice." (Pre-redesign that meant `vices.length >= 2`, "both vices." **Post the 2026-06-29 redesign the roster holds ONE vice**, so the gate is `vices.length >= 1` — zero vices = mid-setup = never collapse; one fully-relapsed vice IS the whole category and collapses. The *principle* is unchanged: gate on the complete category, never on a partial roster.) Likewise count only *scheduled* assets (mirror the skipped-week streak freeze). When in doubt, gate collapse/streak on the complete category.
- **`.error`-before-data applies to EVERY read in a multi-read function, not just the obvious one.** `getOperatingState` checked `.error` only on the ledger read; a transient error on the habits/logs re-read silently rendered an empty roster + $0 provisional as authoritative. Check (or tolerate `PGRST116` for legitimately-absent `.single()` rows) on all of them, then throw so the UI shows "unavailable" rather than a wrong partial state.
- **Changing what a log's `status` field MEANS (or stops writing) must sweep ALL independent readers across modules.** `habit_logs.status` is derived from in *two* unrelated places: the price engine (`price/weeks.ts`) AND the Board insights (`board/insights.ts`) — each buckets logs by status on its own. Flipping vices to affirmative-only (`status='done'`, no more `'relapse'`) fixed the engine but silently broke the Board (its `status==='relapse'` count went permanently 0, so vice patterns vanished from the AI analysis) — no test or typecheck caught it because the CHECK still permits `'relapse'` and the route filter dropped it harmlessly. A `/full-review` caught it. Lesson: when a write-side status semantic changes, `grep` every reader of that column/value across the repo and migrate them together (caught & fixed in `92e68e5`).
- **⚠ SUPERSEDED by the "projection model" lesson at the end of this section.** A `SCORING_VERSION` bump no longer needs a ledger reset and the version guard no longer THROWS — it triggers a REPLAY. (Historical:) the v2→v3 cutover's migrations promised a TRUNCATE no migration performed, so stale rows could mix two regimes; the first fix made `settleUser` THROW `settlement_version_mismatch` on any habit row with `scoring_version < SCORING_VERSION`. That throw is now replaced by recompute-and-replace (the gap self-heals). The durable principle survives: never let two scoring regimes coexist in one value — but the resolution flipped from "refuse + hand-reset" to "replay from facts."
- **`'absent'` (a category the user never held) must NOT arm the recovery ramp — only a real `'broken'` miss does.** In `foldSettlements`, an absent streak category (e.g. no vice yet, mid-setup) was lumped with `'broken'`, flipping `missedYet=true`; a later first full run then booked the (higher) *recovery* bonus instead of the *streak* bonus — over-crediting a habit the user never had. Fix: `'absent'` freezes like `'skipped'` (`continue`), leaving `missedYet` false. Same incomplete-roster principle as the collapse gate above: gate on the complete category, and don't treat "never had" as "lost."
- **A per-user `timezone` that defaults to `'UTC'` but is never captured from the client silently breaks ALL local-day/week math for users west of UTC.** `user_settings.timezone` (migration 0004) defaulted to UTC "to be set during onboarding" — but no code ever set it. The whole price engine keys "what local date is it" / "has this week elapsed" off this column (`runner.ts`, `weeks.ts`, `habits/page.tsx`), so a Pacific user's day rolled over ~7h early: marks made "today" got filed under yesterday, the habits screen showed a fresh (empty) day, and the home value looked stuck a day ahead — and the irreversible weekly close would fire at the wrong instant. Fix (`8b1783e`): `POST /api/settings/timezone` (strict IANA validation — a bogus zone throws in `Intl` on read and blanks the home value) + a `TimezoneSync` client component in `(app)/layout.tsx` that posts `Intl…timeZone` once per session, writing only on change (`.neq`). Lesson: any column the engine reads for correctness that "defaults now, set later" must have the "set later" wired in the SAME change — a sensible default is not a captured value.

- **THE PROJECTION MODEL (2026-06-29, migrations 0027–0030 — the CURRENT scoring architecture; reverses the two ⚠SUPERSEDED lessons above).** The contradiction it resolves: the constants are explicitly "tune after the concierge test," but tuning needs a `SCORING_VERSION` bump, and a bump under the old "permanent ledger + throw-on-mismatch" design forced a per-user ledger wipe back to $200k — destroying the accumulated operating value that *is* the product's hook. Fix: split **facts** (immutable) from **valuation** (a rebuildable projection).
  - **Facts (frozen, append-only):** `habit_logs` (deepest) + `settled_weeks` (a write-once per-week snapshot of the bucketed `PositionWeekInput[]`) + `sprint_closes` (the realized sprint outcome). `settled_weeks.positions` freezes EVERY mutable input to the week math — roster membership, each habit's `area`, the tz/`week_start` bucketing, and the day counts — because the live `habits` row mutates: retiring flips `status` and `weeks.ts` filters on **current** `status='active'` (so a retired habit would vanish from the weeks it was active for), and `area`/`title`/`timezone`/`week_start` are all editable. Replay reads the snapshot, never the live roster. (Raw logs stay the deeper archive: a change to the *bucketing rule* rebuilds snapshots from them as a deliberate migration; a routine constant tune does not.)
  - **Valuation (a projection — freely rebuildable):** `price_ledger` (habit-week family + `sprint_realized`) is a pure function of the facts + current constants. A `SCORING_VERSION` bump is a **REPLAY** (recompute-and-replace), NOT a reset — value re-derives from real history; nobody drops to baseline. `settleUser` rebuilds when a new fact was just frozen OR the version guard detects a gap (the old THROW is now the replay trigger). The rebuild is ATOMIC via the `replay_user_projection` RPC (delete + reinsert in ONE plpgsql transaction — the JS client can't do interactive transactions — so a mid-replay crash can't leave a mixed-version ledger). `board_meetings` is **UPDATED IN PLACE, never deleted** (it's a hybrid row: derived columns beside the user `note`, AI `analysis_*`, and FK-cascading `board_resolutions` — deleting it would erase all three). Replay invariants are pinned in `price/__tests__/replay.test.ts`: (a) determinism, (b) path-independence A→B→A (no hysteresis), (c) tuning-bites — explicitly NOT "any version → same value."
  - **Sprints are the deliberate OPPOSITE of habit weeks:** a closed sprint is a REALIZED event (like a closed trade), version-stable — `sprint_closes` freezes the dollar OUTCOME and replay re-emits it verbatim, so tuning never retro-changes a 6-month-old payoff. (Habit weeks freeze their INPUTS and re-tune the output; sprints freeze the OUTPUT.) `closeSprint` writes the fact FIRST (durable replay source), then the derived ledger row.
  - **The freeze trigger (0011) was re-based onto `settled_weeks` (0029), then onto WALL-CLOCK time (0032).** 0029 moved it off the ledger (which is deleted+reinserted on every replay, so keying the freeze off it would transiently unlock all of history mid-rebuild). But `settled_weeks` is written *lazily* on the first app-open past the grace boundary — so a user who never opened the app left every elapsed week editable (a backfill/tamper window). 0032 rewrites `reject_settled_week_log()` to compute the freeze from `now()` in the user's timezone (reads `user_settings.timezone`/`week_start`; math mirrors `weeks.ts weekStartOf` + `SETTLEMENT_GRACE_DAYS`, hardcoded grace=1 with a coupling comment), so a week locks at the real grace boundary regardless of app-open. `settled_weeks` stays the write-once **replay** anchor; only the *lock predicate* moved to time. The TS↔SQL grace/week-start parity is pinned in `price/__tests__/settled-week-lock.test.ts`.
  - **Grace window (`SETTLEMENT_GRACE_DAYS=1`, in `config.ts`):** absence-of-log is an INFERRED miss/slip for every role, so a calendar week is NOT settled/frozen the instant it ends — it settles the day AFTER (a Sun-ending week settles Tuesday 00:00 local), giving a grace day to fix the just-closed week (forgot to log, travel, sickness, late entry) before the score locks. `buildWeeks` returns a third `pending` state for that day; Home shows last week live-and-editable beside the new week (founder's "Option B"). Settlement is lazy (next load at/after the boundary), not a cron. The grace window does NOT cover a multi-day outage/illness — a true "skip/pause week" is a separate future feature.
  - **Round-2 review remediation (2026-06-30, `SCORING_VERSION` 6, migrations 0033–0035).** (1) **Zero-log PAUSE (v6):** a COMPLETE week where the whole roster logged nothing (`every position completed===0`) books NOTHING and FREEZES every run (a pause is not a miss — streaks + collapse ladders neither advance nor reset; a later real week resumes the streak, doesn't arm recovery). `isZeroLogPause` guards the top of `foldSettlements` (sibling of the empty-roster skip). **CONSEQUENCE: total collapse is now UNREACHABLE** — "vice failed AND every asset zero" is exactly an all-zero week = a pause; vices collapse still fires when assets are logged but the vice is blown. Don't re-add a total-collapse-books test. (2) **As-of-week-END membership (0033):** `weeks.ts` no longer filters live `status='active'`; it includes a habit if it was active as of `wkEnd` via new `habits.archived_at`/`graduated_at` (stamped at every status-flip route). Closes the "archive a failed vice before the lazy settle to dodge its collapse" hole AND updates the runner trailing-window invariant (membership can no longer be dropped by a post-week-end archive). (3) **Sprint bands frozen at create (0034):** `closeSprint` prices against `sprints.payoff_bands`/`goal_bonus_pct` frozen on the row (via `bandFromFrozen`), not live `SPRINT_PAYOFF_BANDS` — a mid-sprint tune can't move an open payout. Deliberately reverses 0014's `locked_grid` drop but WITH a reader. `create_sprint_atomic` RPC makes create atomic (no zero-task active orphan). (4) **Replay concurrency guard (0035):** `replay_user_projection` gained `pg_advisory_xact_lock(user)` + an optimistic `replay_stale` guard (max week_index + version); `settleUser` retries once and self-heals an orphaned week (frozen but missing its `habit_week` ledger row) via a Phase-1 check that widens the short-circuit to `!hasNewWeek && !versionGap && !hasOrphan`.

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
- **`price_ledger` is idempotent-by-key, so the first settlement of a week is permanent.** A wrong first booking can't be re-settled (the unique `settlement_key` + `ignoreDuplicates` blocks a redo). Therefore: never book from a failed/partial DB read (check `.error` on every read *before* settling), and treat a settled week's `habit_logs` as frozen — late edits silently diverge raw from the booked ledger. **This is now ENFORCED** (migration 0011): a `BEFORE INSERT/DELETE` trigger on `habit_logs` rejects writes whose `local_date` falls in `[weekEnd-6, weekEnd]` of any `habit_week_settled` ledger row (the ledger's `occurred_at` carries the boundary — no week-index/tz recompute). `/api/habits/log` maps the trigger's `settled_week_locked` message to a 409.
- **Keep pure logic out of `server-only` modules so it stays unit-testable.** Adding `import 'server-only'` makes Vitest fail to import the whole module (it resolves to the throwing client variant). Pattern: pure functions in a plain module (e.g. `price/weeks.ts`), the `server-only` marker only on the thin I/O shell that touches the service-role client (`price/runner.ts`). To unit-test the shell anyway, `vi.mock('server-only', () => ({}))` + a fake `createServiceClient` (see `price/__tests__/runner.test.ts`).
- **Any predicate that books an irreversible ledger row must be robust to an INCOMPLETE roster.** The habit-creation gate caps the *maximum* (≤2 vices, ≤1 of each cadence), never the minimum — a setup-in-progress roster (e.g. 1 vice) is valid and still gets settled. So `isVicesCollapse` must gate on the COMPLETE vice set, not "any present vice." (Pre-redesign that meant `vices.length >= 2`, "both vices." **Post the 2026-06-29 redesign the roster holds ONE vice**, so the gate is `vices.length >= 1` — zero vices = mid-setup = never collapse; one fully-relapsed vice IS the whole category and collapses. The *principle* is unchanged: gate on the complete category, never on a partial roster.) Likewise count only *scheduled* assets (mirror the skipped-week streak freeze). When in doubt, gate collapse/streak on the complete category.
- **`.error`-before-data applies to EVERY read in a multi-read function, not just the obvious one.** `getOperatingState` checked `.error` only on the ledger read; a transient error on the habits/logs re-read silently rendered an empty roster + $0 provisional as authoritative. Check (or tolerate `PGRST116` for legitimately-absent `.single()` rows) on all of them, then throw so the UI shows "unavailable" rather than a wrong partial state.
- **Changing what a log's `status` field MEANS (or stops writing) must sweep ALL independent readers across modules.** `habit_logs.status` is derived from in *two* unrelated places: the price engine (`price/weeks.ts`) AND the Board insights (`board/insights.ts`) — each buckets logs by status on its own. Flipping vices to affirmative-only (`status='done'`, no more `'relapse'`) fixed the engine but silently broke the Board (its `status==='relapse'` count went permanently 0, so vice patterns vanished from the AI analysis) — no test or typecheck caught it because the CHECK still permits `'relapse'` and the route filter dropped it harmlessly. A `/full-review` caught it. Lesson: when a write-side status semantic changes, `grep` every reader of that column/value across the repo and migrate them together (caught & fixed in `92e68e5`).
- **A per-user `timezone` that defaults to `'UTC'` but is never captured from the client silently breaks ALL local-day/week math for users west of UTC.** `user_settings.timezone` (migration 0004) defaulted to UTC "to be set during onboarding" — but no code ever set it. The whole price engine keys "what local date is it" / "has this week elapsed" off this column (`runner.ts`, `weeks.ts`, `habits/page.tsx`), so a Pacific user's day rolled over ~7h early: marks made "today" got filed under yesterday, the habits screen showed a fresh (empty) day, and the home value looked stuck a day ahead — and the irreversible weekly close would fire at the wrong instant. Fix (`8b1783e`): `POST /api/settings/timezone` (strict IANA validation — a bogus zone throws in `Intl` on read and blanks the home value) + a `TimezoneSync` client component in `(app)/layout.tsx` that posts `Intl…timeZone` once per session, writing only on change (`.neq`). Lesson: any column the engine reads for correctness that "defaults now, set later" must have the "set later" wired in the SAME change — a sensible default is not a captured value.

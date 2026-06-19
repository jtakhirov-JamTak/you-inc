# CLAUDE.md

## Project Overview

You, Inc. — a self-development app where the user runs themselves like a company (PWA).
Home is a Robinhood-style "price" representing operating health (NOT self-worth), starting at $200,000.

Planned product areas:
- **Identity** — core values + how people experience you (e.g. listener by default, leader for close people, strategist under pressure)
- **Year goals** — one each in health, wealth, relationships
- **Sprints** — 10–14 day pushes toward the year goals
- **Habits** — 2 vices to remove, 3 habits to add (one daily, one morning, one weekly)
- **Regulation** — splits roadblock (cognitive → decision/time matrix) from trigger (emotional → stillness, containment); rule: regulate first, then decide
- **Weekly board meeting** — Sunday review of what moved the price
- **Journaling** — handwritten, off the app (morning planning, night reflection)

Solo founder, non-technical — explain in plain language, wait for approval before changing code.

## Foundation provenance

This repo was extracted as a clean foundation from a prior app (Pure EQ). What carried over: auth, Supabase client/server/service wiring, Sentry (with PII scrubber), rate limiting, origin checks, RLS discipline, the app shell + UI atoms, voice input (Whisper), and the Engineering Playbook. All product domain was stripped. `0001` creates only `user_profiles`.

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

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS (Storm dark theme in `globals.css`)
- **Backend:** Next.js API routes (server-side)
- **DB:** Supabase (PostgreSQL + Row-Level Security)
- **Auth:** Supabase Auth (email/password + Google OAuth)
- **Voice:** OpenAI Whisper API (`/api/transcribe`)
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

## Do's

- Run `npx tsc --noEmit` before considering work complete
- Explain briefly what you're doing and why before making changes
- Use Zod validation on every API endpoint and every AI output
- Use Supabase RLS — every user table with `USING (auth.uid() = user_id)`
- Voice + text input on every free-text field
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
- User free-text is untrusted in AI prompts — delimit from instructions
- Rate-limit AI, auth, and enumeration endpoints
- Never log response bodies or user content
- Any unauthenticated server-to-server webhook receiver MUST be added to `middleware.ts`'s public-route allowlist in the same change that adds the route

## Lessons Learned

(Project-specific lessons go here as they accrue. Universal patterns belong in `docs/Engineering_Playbook.txt`.)

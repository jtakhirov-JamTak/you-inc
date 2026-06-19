# You, Inc.

A self-development app where you run yourself like a company (PWA). Set year goals across health, wealth, and relationships; run short sprints; track the habits and vices that move your operating-health "price"; and review what moved it at a weekly board meeting.

## Quick Start

```bash
cp .env.example .env.local   # Fill in your keys
npm install
npm run dev                  # http://localhost:3000
```

## Stack

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS + Supabase (PostgreSQL + Auth + RLS) + OpenAI Whisper API (voice) + Zod. Anthropic Claude API is wired for AI features (Phase B).

## Status

This repo is a **foundation** extracted from an earlier app: auth, Supabase wiring, Sentry, rate limiting, origin checks, RLS discipline, UI atoms, and the app shell — with zero product domain. The product domain (Identity, Goals, Sprints, Habits, Regulation, Board Meeting) and the score/price engine are built on top of it.

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Project structure, conventions, lessons learned
- **[docs/Engineering_Playbook.txt](./docs/Engineering_Playbook.txt)** — Reusable security and architecture patterns

## Commands

| Task        | Command            |
|-------------|--------------------|
| Dev server  | `npm run dev`      |
| Build       | `npm run build`    |
| Type check  | `npx tsc --noEmit` |
| Lint        | `npm run lint`     |
| Tests       | `npm test`         |
| Regen types | `npm run db:types` |

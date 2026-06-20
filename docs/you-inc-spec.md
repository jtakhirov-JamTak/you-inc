# You, Inc. — Framework & Requirements (FROZEN · SOT · rev 2)

## Concept
A self-development app where you operate yourself like a company. The home screen is a single **operating value** — a portfolio-style price that moves as you execute. It represents **operating health, not self-worth**. Baseline: **$200,000**.

## Governing principles (locked)
- Operating health, not self-worth.
- Home reads like a portfolio.
- **Habits are balance-sheet positions; sprints are investments.**
- Regulate first, then decide.
- Assets compound; liabilities retire on a clean streak; failures are **written down, never shamed**.
- Reward the **process** (controllable), not just the **outcome** (partly luck).
- Color (green up / red down) appears **only on the number**, never on chrome.
- Internally, **long/short applies to habits only** (assets = long; liabilities = short, paying down). The user sees **assets/liabilities**. **Sprints are always shown as investments**, never long/short. No "buy/sell/short" language.

## Goal architecture
- **One-year goals** — one per area: **Health / Wealth / Relationships.**
- **Sprints** — 10–14 day investments laddering up to a year goal.
- **Habits** — the recurring operations that maintain the company between sprints.
- Distinction: **habits maintain operating health; sprints create growth.**

## Design system
- **Color:** Cream `#FAF3EC` · Surface `#FFFFFF` · Ink `#211E1A` · Muted `#7A736B` · Up `#2F7058` · Down `#BD5638`.
- **Type:** Schibsted Grotesk — display (800) + UI/body (400–600). JetBrains Mono — figures only. **No serif.**
- **Layout:** 8pt grid · radius 14 · cards float on cream · color only on the number.
- **Sprints use a distinct gold/amber "investment" treatment**, set apart from the cream/white balance-sheet positions.

## Screens (5 tabs: Home · Identity · Sprints · Habits · Board)

### Home — the portfolio
- Header: "You, Inc. · $YOU — privately held."
- **Operating value** (mono): `$204,300`.
- Deltas on the fold: **Week/Week** (primary) and **Day/Day** (secondary).
- Trend chart + range toggle: 1W / 1M / 3M / 1Y / ALL.
- **Positions · Habits** (Net ▲ +$X) with a per-line **contrib/wk** column:
  - *Assets · building* — each habit as a position: tag (Morning/Daily/Weekly), term, day x/term, weekly contribution.
  - *Liabilities · paying down* — each vice: days clean, status, contribution.
- Sprints are represented on Home by the active sprint card; their return books to operating value **only at close** (see Sprint settlement).
- **This layout is fixed SOT — do not redesign.**

### Habits — the balance sheet
- "Assets compound. Liabilities retire on a clean streak." · Net 7D total.
- **Assets · building (mature by accumulation):** position rows with tag, contribution, term, day x/term. Active row exposes **Term review → Renew / Replace / Graduate**.
- **Graduated · holdings shelf:** completed habits, marked automatic — "your long-term position, proof of what you've built."
- **Liabilities · paying down (retire by clean streak):** vice, open-ended days-clean counter, "retires at a 30-day streak," progress.
- Rules: position size (7/14/30/60d) is a **commitment/review term, not a maturity claim**. Graduation is a **human judgment**, never auto. Liabilities **reopen gracefully** on relapse.

#### Asset roster (fixed shape)
- Exactly **3 asset habits: 1 morning · 1 daily · 1 weekly** (cadence tags). Plus **2 liabilities** (vices).
- **Scoring reconciliation:** the scoring table's "daily habit ×2" = the **morning + daily** habits; the "weekly habit" = the third slot.
- The **weekly slot supports a custom recurrence** (every N days, or chosen weekdays), so its scheduled occurrences per calendar week can **vary** (e.g., 2 one week, 3 the next).

### Identity — the charter (USER-POPULATED)
All Identity content is user-authored at setup and editable; nothing is system-generated.
- **Values:** exactly 3, user-entered. Each = `{ title, meaning }`.
- **Modes:** 3 fixed contexts — **baseline** (default) / **with close people** / **under pressure**. Each has **2 user-populated boxes = `{ mode name, one-line description }`** (e.g., baseline → "The Listener" + one line).
- **Affirmations:** user-entered. The app guides authoring — each affirmation pairs an **affirmation statement + an objective visualization** (helper copy teaches the format). Record = `{ affirmation, visualization }`.
- Footer principle: **Regulate first, then decide.**

### Sprints — investments
- A sprint is a **time-boxed 10–14 day investment, not a habit**, invested toward a year goal in an area.
- Fields: **Size** (Small/Medium/Big), **Area**, **Thesis** (falsifiable "if I do X, the goal becomes real"), **Tasks**, **Term**.
- **One active sprint at a time**, plus a **queue** — the next shows "Starts in N days" and begins when the active one closes. Sequential, never parallel.
- **Unrealized returns:** current completion tier read off the locked payoff grid (can be negative early), shown live on the sprint card.
- **Realized return:** the final tier on the locked grid, booked at close.
- A paid-off sprint can **graduate into a maintained habit** (a new balance-sheet asset).
- **Score only controllable outcomes** ("went on 2 dates"); the year-goal target ("find a girlfriend") stays the **thesis**, never the scored outcome.

### Board — the weekly statement
- "Sunday review — what moved the price." Vol/No header.
- Closing value + week delta · **Note to the chair** (narrative) · Health / Wealth / Relationships contribution · **Resolutions for next week** (checkable) · "Adjourn & open next week."

## Scoring

### Base — two denominators (explicit hybrid)
- **Habit / streak / collapse scoring uses a fixed $200k baseline** — a given % is always that % of $200,000 (e.g. +1.75% = +$3,500, regardless of current balance).
- **Sprint payoffs use `balance_at_set_time`, frozen at sprint open** (see Sprint dollar mechanics).
- **Simple, not compounding** — chosen for legibility, constant stakes, survivable drawdowns.
- *Implication (intended):* habit contributions are fixed-dollar while sprint stakes scale with the account, so habits become a proportionally smaller mover as the company grows — operations steady, investments scale.
- Milestones/re-rates are **arbitrary motivational devices**, not transformation tracking.
- **Comeback > perfection:** recovery after a lapse is rewarded faster than an unbroken streak.

### Habits (weekly)
| Item | +/day | wk cap + | −/day | wk cap − |
|---|---|---|---|---|
| Vice (×2) | +0.25% | +1.75% | −0.50% | −3.50% |
| Daily habit (×2) | +0.25% | +1.75% | −0.25% | −1.75% |
| Weekly habit | 4% ÷ days | +4.00% | −4% ÷ days | −4.00% |
| **Max week** | | **+11.00%** | | **−14.50%** |

- **Weekly-habit "÷ days":** the ±4% cap is divided by the **scheduled occurrence count for that specific week**, derived from the habit's recurrence rule (timezone / week-boundary aware). A week scheduled twice → ±2% per occurrence; three times → ±1.33%.
- **Streak bonus** (per category, consecutive full weeks): ramps 1%→4.5%, peaks **6% at weeks 13–14**, settles 3% at 17+ (front-loaded into the hard weeks).
- **Recovery bonus** (after a missed week): 1/2/3/4/5/6%, then matches the regular streak at week 7.
- **Collapse penalty** (consecutive zero weeks): vices −1/−2/−3% · habits −2.5/−3.5/−5%.

### Sprints — payoff by % of tasks completed
| Completion | Small | Medium | Big |
|---|---|---|---|
| 0% | −7% | −10% | −14% |
| >0–20% | −5.5% | −8% | −12% |
| >20–40% | −3.5% | −5% | −7% |
| >40–50% | 0% | 0% | 0% |
| >50–70% | +1% | +1.5% | +2% |
| >70–85% | +3.5% | +5% | +7% |
| >85–99% | +5.5% | +8% | +12% |
| >99% | +7% | +10% | +14% |
| **Goal-achieved bonus** | +3% | +5% | +6% |

- Process is ~70% of max payoff; goal bonus ~30%. Process axis is **symmetric** (bigger bet = bigger payoff *and* bigger write-down); the goal bonus is **upside-only**.
- Outcomes: completed = realized return · partial = partial return + lesson · failed = **write-down + board review, not shame**.

### Sprint dollar mechanics (set-time lock)
- At **finalize**, the table percentages convert to a **fixed dollar payoff grid** using the balance on the sprint's **set-date**: `payoff = table % × balance_at_set_time`.
- That grid is **frozen for the sprint's duration** — balance drift during the sprint never changes it.
- Every **new** sprint re-prices off the then-current balance, so **proportional stakes stay constant (~14–20% per Big bet) while absolute dollars scale with the account.**
  - Big at $200k → envelope **+$40k / −$28k**.
  - Big at $500k → envelope **+$100k / −$70k**.
- **Finalize screen (the commit step):** before a sprint opens, show the locked envelope in dollars + % "at today's balance" — e.g. *"Complete this → +$40,000 (+20%). Miss entirely → −$28,000 (−14%). Locked at today's $200,000."*
- **Gate Big bets by demonstrated execution** — a Big bet risks ~14% of the company, and new users fail most; don't offer Big until there's a track record.

### Sprint settlement (locked)
- **Operating value is realized-only.** The sprint card shows **live unrealized returns**, but the sprint affects the operating value **only at close**, when the realized return books in (and appears in "what moved the price" / the Board statement).
- Rationale: avoids punishing users mid-sprint, and makes the Board review the meaningful settlement event.

## Engineering requirements (locked)
- **Price engine:** deterministic, **server-computed only** (never client-side), **versioned** (`scoring_version` on every result), **config-driven** (all scoring constants in one typed config module — the numbers are unvalidated and will be tuned via config, not refactor).
- **Event-sourced ledger:** operating value = deterministic fold over an **append-only `price_ledger`** (events: `habit_week_settled`, `sprint_realized`, `collapse_penalty`, `streak_bonus`, …). No client inserts/updates/deletes; ledger writes only via trusted server code / SECURITY DEFINER RPCs.
- **Raw + derived:** `habit_logs` are raw per-day completions; weekly settlement and ledger events are derived from them. Keep raw and derived strictly separate.
- **Separate lifecycles:** assets (mature by accumulation), liabilities (retire by clean streak, reopen on relapse), and sprints (set-time-locked, realized at close) each have **distinct** lifecycle logic — do not abstract them into one generic position lifecycle.
- **Timezone / week boundaries:** weekly settlement depends on user timezone + week-start (`user_settings`); handle DST. Define the settlement trigger (scheduled per-timezone job vs. lazy-on-read).
- **Idempotent settlements:** deterministic settlement keys (e.g. `user_id + week_index + scoring_version`; `sprint_id + 'realized'`) under unique constraints, so reruns/replays never double-book.
- **Recurrence engine:** compute scheduled occurrences per settlement week from each habit's `recurrence_rule`; feeds the weekly "÷ days" divisor.
- **RLS on every table** (`auth.uid() = user_id`); filter by userId on every query.
- **Build:** cloned from an existing Next.js + TypeScript + Supabase + Tailwind app; payments/coins stripped; price engine net-new.

## Status
- **Unvalidated** — no real-user data yet. Don't present scoring numbers as proven. Planned next step: a manual concierge test (10–20 users, control group, targeting the week 3–6 drop-off cliff). The config-driven engine + replayable ledger let every number be re-tuned post-test without an engine rewrite.

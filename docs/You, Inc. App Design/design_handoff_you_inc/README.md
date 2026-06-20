# Handoff: You, Inc. — Android App (Home, Habits, Identity, Board)

## Overview
**You, Inc.** is a self-development app that frames the user as a company. The signature idea: a Robinhood-style "operating value" (a price) represents the user's **operating health — explicitly not self-worth**, starting at $200,000. The app reframes personal-development concepts in financial-statement language without ever becoming cynical or punishing.

This bundle covers three finalized screens plus a design-foundations reference:
- **Home** — portfolio view: operating value + chart, habits as *positions*, sprints as *investments*.
- **Habits** — a balance sheet: assets (good habits) and liabilities (vices), on different lifecycles.
- **Identity** — the company "charter": core values + the three modes people experience.
- **Board** — Sunday weekly review, styled as a one-page operating statement.

App structure (full vision, for context — only the above are designed so far): Identity · Year goals · Sprints · Habits · Regulation · Weekly board meeting · Journaling (handwritten, off-app).

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly.** The HTML is built on a small in-house template runtime (`support.js`) and a starter Android device frame (`android-frame.jsx`); neither is meant to ship.

The task is to **recreate these designs in the target codebase's environment.** This is an **Android app**, so the natural target is native Android (Jetpack Compose / Kotlin) or whatever cross-platform stack the team already uses (React Native, Flutter). Use the codebase's established patterns, navigation, and component libraries. The device chrome (status bar, nav bar) in the mocks is provided by the OS/framework — ignore it and build only the screen content + bottom tab bar.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and layout. Recreate pixel-faithfully using the codebase's native components. Exact hex values, type sizes, and spacing are documented in **Design Tokens** below. Dollar figures, percentages, streak counts, and copy are realistic placeholders — wire them to real data.

---

## Global System

### Layout shell
- Screen canvas: **412 × 892** dp (design reference width; build responsive).
- Background: **Cream `#F6F3EC`** for all screens.
- Content: single vertical scroll, **18dp** horizontal padding (Board uses 20dp), **16–18dp** top padding.
- **Bottom tab bar** (fixed, not scrolled): white `#FFFFFF`, 1px top border `#E6E0D4`, 5 tabs evenly spaced, ~9dp top padding. Tabs: **Home · Identity · Sprints · Habits · Board**. Active tab = ink `#211E1A` icon + label (weight 600); inactive = muted `#B4AC9D`. Labels 9.5dp.

### Core principles (carry into implementation)
1. **Operating health, not self-worth** — never frame the price as a judgment of the person.
2. **No buy/sell/short/trade language in the UI, ever.** Internally habits behave like long/short positions, but the user only ever sees **Assets** and **Liabilities**.
3. **Color appears only on numbers** (green up / red down). All chrome stays cream/ink/muted — no colored buttons, headers, or accents.
4. Assets and liabilities **share the balance-sheet visual but run on different lifecycles** (see Habits).

---

## Screens / Views

### 1. Home — "The Portfolio"
**Purpose:** At-a-glance operating health, then the holdings that drive it.

**Layout (top → bottom):**
1. **Header row** — left: 28dp rounded-square ink logo tile with "Y" (mono, white) + "You, Inc." (13.5dp, weight 700) over "$YOU · PRIVATELY HELD" (mono 9.5dp, muted). Right: 30dp circle avatar placeholder (`#EFEADF`, 1px border).
2. **Operating value block** — label "OPERATING VALUE" (mono 10dp, letter-spacing 0.2em, muted). Value **`$204,300`** in **JetBrains Mono, 48dp, weight 600, letter-spacing −0.035em**. Below, two stats in a row (gap 24dp): **WEEK / WEEK** (mono 9dp label; value 22dp weight 600 green `#2F7D5B`) and **DAY / DAY** (label same; value 14dp weight 500 muted `#7A7368`). WoW is primary, DoD secondary.
3. **Chart card** — white, radius 14, 1px border `#E6E0D4`, padding 14/12/10. SVG area chart, 340×150 viewBox, height 146. Three horizontal gridlines `#EFEADF`. Line: green `#2F7D5B`, 2.5px, round joins; area fill = vertical green gradient 0.16→0 opacity. Below chart: range pills row (gap 5) — **1W** active (ink bg, cream text), 1M/3M/1Y/ALL inactive (1px border, muted text). All pills mono 10dp, radius 7, padding 4/11.
4. **Positions · Habits** — section header row: "POSITIONS · HABITS" (mono 10dp, 0.12em, muted) + right "NET ▲ +$1,600" (mono 12dp weight 600 green). Card: white, radius 14, padded 4/16. Inside, two sub-groups separated by hairlines `#F0EBDF`:
   - Group label row: left "ASSETS · BUILDING" (mono 9dp green), right "CONTRIB / WK" (mono 9dp `#b0a895`).
   - 3 asset rows: 32dp rounded-square category badge (AM / DAY / WK — each its own tint, see tokens) + title (13.5dp weight 600) over subline (10.5dp muted, e.g. "Morning · 14-day term · day 12"). Right: contribution (mono 13dp weight 600 green, e.g. +$600) over a small % (mono 9dp `#b0a895`).
   - Group label row: "LIABILITIES · PAYING DOWN" (mono 9dp red `#BD5638`) + "DAYS CLEAN".
   - 2 liability rows: red-tint 32dp badge with "↓" + title over subline ("4 days clean · open"). Right: green contribution + "clean".
5. **Investments · Sprints** — section header: "INVESTMENTS · SPRINTS" (mono 10dp muted) + "1 ACTIVE" (mono 11dp gold `#A6802C`).
   - **Active sprint card** — **gold theme**: bg `#F3EAD2`, 1px border `#E4D3A6`, radius 14. Top row: "ACTIVE · 10–14 DAY PUSH" (mono 9dp `#9A7322`) + "DAY 6 / 14". Title "Reclaim mornings" (18dp weight 700). Subline "Invested toward year goal · Health" (11dp `#8a7a4e`). Progress bar: track `#E4D3A6`, fill gold `#A6802C`, 6dp, radius 3, 43%. Bottom row: "RETURN SO FAR" (mono 9.5dp) + "+$3,500" (mono 14dp weight 600 `#7C5E18`).
   - **Queued sprint row** — white card, radius 12: "Deep work blocks" (13dp weight 600) over "Queued · toward Wealth" (10.5dp muted); right "STARTS 8d" (mono 10dp muted).

### 2. Habits — "The Balance Sheet"
**Purpose:** Manage the habits (assets) and vices (liabilities) that move the price. **This is the most important model — read carefully.**

**Locked model:**
- Internal framing is long/short, but the **user only ever sees Assets and Liabilities.** No buy/sell/short language anywhere.
- Assets and liabilities **share the balance-sheet visual but run on different lifecycles.**

**Layout:**
1. **Header** — "Habits" (Schibsted Grotesk 800, 30dp, −0.03em) + right "NET / WK ▲ +$1,600" (mono 15dp weight 600 green). Subtitle: "Assets compound. Liabilities retire on a clean streak." (13dp muted).
2. **ASSETS · BUILDING** — section header (mono 10dp green) + right "MATURE BY ACCUMULATION" (mono 9dp `#b0a895`). Then asset cards (white, radius 14):
   - Each card: category badge chip (MORNING/DAILY/WEEKLY, tinted) + title + contribution (green). Below: a **commitment term** — "14-DAY TERM" (mono 9dp muted) + "DAY 12 / 14", and a **days-done progress bar** (green fill on `#EFEADF`).
   - **Assets mature by accumulation (days done)** — the bar fills as days are completed.
   - The **term (7/14/30/60) is a commitment-and-review window, NOT a maturity claim** — an arbitrary motivational window, not transformation tracking.
   - At **term end**, the card shows a review row: "TERM REVIEW · 2D" + three pills: **Renew · Replace · Graduate** (Graduate = ink filled pill). Only show this when near/at term end.
   - **Graduation is a human judgment** ("this feels automatic now") — **never an automatic day-30 trigger.**
3. **GRADUATED · HOLDINGS SHELF** — section header (mono 10dp ink) + count. A wrap of **pill chips** (white, 1px border, fully rounded, green ✓ + label, 12dp). Caption: "Automatic now — your long-term position, proof of what you've built." Graduated assets move here permanently.
4. **LIABILITIES · PAYING DOWN** — section header (mono 10dp red) + "RETIRE BY CLEAN STREAK". Liability cards: **bg `#FBF1ED`, 1px border `#EDD9D0`** (warm red tint), radius 14.
   - Title + subline "Open counter · retires at a 30-day streak". Right: **big open-ended clean counter** — 2-digit mono number 24dp green over "DAYS CLEAN" (mono 9dp).
   - Below: a row of filled day-squares (16dp, radius 5, green) trailing into "→ OPEN" — **no countdown, no "days left."**
   - **Liabilities retire by abstinence streak (days clean).** Hit the clean term → liability retires. **Relapse reopens the counter gracefully — never punished.** Caption: "A relapse just reopens the counter. Gracefully — never punished."

### 3. Identity — "The Charter"
**Purpose:** The values and behavioral modes the "company" is run by.

**Layout:**
1. **Header** — "Identity" (Grotesk 800, 30dp) + subtitle "The charter the company is run by." (13dp muted).
2. **CORE VALUES** — section label (mono 10dp muted). A grouped list (hairline-separated white rows on `#E6E0D4`, radius 14): each row = value name (16dp weight 700, fixed 104dp column) + description (12.5dp muted). Example values: **Integrity** ("The numbers match the story."), **Steadiness** ("Compounding beats intensity."), **Service** ("Build value others can draw on.").
3. **HOW PEOPLE EXPERIENCE YOU** — section label, then 3 mode cards:
   - **Default mode** — **ink card `#211E1A`, cream text.** Top row: "DEFAULT MODE" (mono 9dp muted) + "● ACTIVE" (mono 9dp green `#57B584`). Mode name "The Listener" (24dp weight 800). Description (12.5dp `#b8b0a0`).
   - **With close people** — white card: "WITH CLOSE PEOPLE" + "The Leader".
   - **Under pressure** — white card: "UNDER PRESSURE" + "The Strategist".
4. **Footer rule** — dashed-border pill: "REGULATE FIRST, THEN DECIDE" (mono 11dp muted). (This is the Regulation principle surfacing on Identity.)

### 4. Board — "The Weekly Statement"
**Purpose:** Sunday review of what moved the price. Styled as a one-page operating statement (editorial).

**Layout:**
1. **Statement header** — mono 9.5dp row: "WEEKLY STATEMENT" + "VOL.1 · W24", with a full-width **1px ink rule** under it.
2. **Title** — "Board meeting." (Grotesk 800, 42dp, −0.035em, two lines). Subtitle "Sunday review · what moved the price."
3. **Closing value** — "CLOSING VALUE" (mono 9.5dp) + `$204,300` (mono 34dp weight 600). Right: "▲ +$4,300" (14dp green) over "+2.15% this week".
4. **Mini line chart** — bare ink polyline (no fill), 330×50, 1.5px.
5. **Note to the chair** — bracketed by hairline rules top/bottom. Label "NOTE TO THE CHAIR" (mono 9.5dp) + a reflective sentence (16dp, weight 500, `#39342c`), e.g. "The business compounded on mornings this week, and gave a little back to a skipped review. Steady is the strategy."
6. **Area stats** — 3-column row (vertical dividers `#DBD3C2`): HEALTH +3.5k (green), WEALTH +1.2k (green), RELATION. −0.4k (red). Mono 17dp weight 600.
7. **Resolutions for next week** — label + 2 checkbox rows (white card, 16dp checkbox square outline + 13dp text).
8. **Adjourn CTA** — full-width ink button `#211E1A`, cream text, radius 13: "Adjourn & open next week →".

---

## Interactions & Behavior
- **Bottom tabs** navigate between the 5 sections (Sprints not yet designed).
- **Chart range pills** (1W/1M/3M/1Y/ALL) swap the chart series; selected pill = ink fill.
- **Habits — asset term review** (Renew / Replace / Graduate) appears only when a habit is at/near its term end:
  - **Renew** → restart the same habit on a new term.
  - **Replace** → swap for a different habit.
  - **Graduate** → user-confirmed only; moves the chip to the Holdings shelf. Never auto-graduate on a day count.
- **Habits — liability counter**: increments daily while clean; on relapse, resets to 0 and "reopens" (no penalty UI, no red alarm). Retires when it reaches its clean term.
- **Board — resolution checkboxes** toggle complete.
- Transitions should be calm/subtle (≤200ms ease). Avoid celebratory or punitive animation — tone is steady, not gamified.

## State Management
- **Operating value**: current value, open value ($200,000), WoW %, DoD %, time series per range. Derived from contributions.
- **Habits (assets)**: id, title, cadence (morning/daily/weekly), term length (7/14/30/60), days-done count, weekly contribution, status (active / at-review / graduated). Graduated flag is set by explicit user action.
- **Habits (liabilities)**: id, title, clean-streak count (open-ended), clean term to retire (e.g. 30), status (active / retired). Relapse resets streak to 0.
- **Holdings shelf**: list of graduated asset titles.
- **Sprints**: id, title, length (10–14 days), current day, linked year-goal area (Health/Wealth/Relationships), return-so-far, status (active/queued).
- **Identity**: core values (name + description), three modes (default/close/pressure), active mode.
- **Board**: weekly snapshot — closing value, deltas, note text, area contributions, resolutions.

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| Cream | `#F6F3EC` | App background |
| Surface | `#FFFFFF` | Cards |
| Ink | `#211E1A` | Primary text, active states, dark cards, CTAs |
| Muted | `#7A7368` | Secondary text |
| Muted light | `#9a9183` | Tertiary labels |
| Faint | `#b0a895` / `#B4AC9D` | Hints, inactive tab |
| Hairline | `#F0EBDF` | In-card dividers |
| Border | `#E6E0D4` | Card borders |
| Up (green) | `#2F7D5B` | Positive figures, asset accents |
| Up (green, on dark) | `#57B584` | Green on ink cards |
| Down (red) | `#BD5638` | Negative figures, liability accents |
| Liability card bg | `#FBF1ED` | Liability card surface |
| Liability border | `#EDD9D0` | Liability card border |
| Gold accent | `#A6802C` | Sprint/investment accent |
| Gold text deep | `#7C5E18` / `#9A7322` | Sprint figures/labels |
| Gold card bg | `#F3EAD2` | Active sprint card |
| Gold border | `#E4D3A6` | Sprint card border / progress track |
| Asset badge — morning | bg `#E4EFE7` / text `#2F7D5B` | Category chip |
| Asset badge — daily | bg `#EFE7D3` / text `#7A6A45` | Category chip |
| Asset badge — weekly | bg `#DEE9EE` / text `#3a5a6e` | Category chip |
| Liability badge | bg `#FBE7DF` / text `#BD5638` | Category chip |

### Typography
- **Display / UI:** Schibsted Grotesk. Weights used: 400, 500, 600, 700, 800. Screen titles = 800 / 30dp / −0.03em. Board title = 800 / 42dp / −0.035em. Mode names = 800 / 24dp.
- **Figures (numbers, tickers, labels):** JetBrains Mono. Operating value = 600 / 48dp / −0.035em. Section/eyebrow labels = 9–10dp with 0.1–0.2em letter-spacing, uppercase.
- **Body:** Schibsted Grotesk 400–600, 11–14.5dp.
- No serif anywhere (deliberately dropped to avoid the saturated "cream + serif" AI look).

### Spacing & shape
- Grid: 8pt base; common gaps 9/10/11/14/18/22/24dp.
- Card radius: **14** (primary), 12 (compact rows), 999 (holdings chips), 7 (pills).
- Card border: 1px. Card shadow: essentially none — cards float on cream via border + bg contrast only.
- Progress bars: 5–6dp height, radius 3.

### Iconography
- Tab icons are simple geometric glyphs (square, circle, diamond, bars, 2×2 dots). Replace with the codebase's icon set; keep them minimal/monoline. **No emoji** (except the optional 🔥 streak indicator, which can be replaced with a flame icon).

## Assets
- **Fonts:** Schibsted Grotesk + JetBrains Mono (Google Fonts). Use the equivalent in-app font resources.
- **No raster images or logos** — the "Y" logo tile is a typographic mark (mono "Y" on ink). Avatar is a placeholder circle.
- **Charts** are simple SVG polylines/areas — implement with the platform's native charting or a lightweight chart lib; exact point data is placeholder.

## Files
- `You, Inc.dc.html` — the full design: foundations panel + Home, Habits, Identity, Board frames (and a chart-detail reference). **Primary reference.** Open in a browser to view all screens side by side.
- `android-frame.jsx` — the device-frame wrapper used to mock Android chrome (reference only, do not port).
- `support.js` — the prototype's template runtime (reference only, do not port).
- `screenshots/` — rendered captures of the screens.

> Not yet designed: **Year goals, Sprints (detail), Regulation, Journaling.** Regulation is the notable one — it splits a *roadblock* (cognitive → decision/time matrix) from a *trigger* (emotional → stillness/containment), with the rule "regulate first, then decide."

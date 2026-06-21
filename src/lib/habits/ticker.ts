// Derive a short uppercase "ticker" symbol for a position from its title (design
// handoff §1 — "store it, or derive from the title"). Pure + deterministic so
// Home rows read like a holdings list (STILL, MOVE, BKFST). No storage: recomputed
// each render from the title, deduped across the roster in the order given.

const MIN = 3;
const MAX = 5;

// One title → a base symbol: letters only, uppercased. Prefer the first
// meaningful word truncated (DEEP, WORK); fall back to joined initials/letters
// when the first word is too short ("Go run" → GORUN).
function baseTicker(title: string): string {
  const words = title
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "POS";
  const first = words[0].slice(0, MAX);
  if (first.length >= MIN) return first;
  // First word too short — glue words together for a readable stub.
  const glued = words.join("").slice(0, MAX);
  return glued.length >= MIN ? glued : (glued + "POS").slice(0, MIN);
}

// Make `base` unique against `taken` by trimming and appending a numeric suffix
// (DEEP → DEE2 → DEE3 …), staying within MAX chars.
function unique(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = String(n);
    const cand = (base.slice(0, MAX - suffix.length) + suffix).toUpperCase();
    if (!taken.has(cand)) return cand;
  }
  return base; // pathological — give up and reuse (caller still renders)
}

/**
 * Derive a unique ticker for one title given the symbols already taken. Mutates
 * `taken` by adding the result, so calling it across a roster yields distinct
 * symbols in order.
 */
export function deriveTicker(title: string, taken: Set<string>): string {
  const t = unique(baseTicker(title), taken);
  taken.add(t);
  return t;
}

/** Derive tickers for a list of titles in order — distinct within the list. */
export function deriveTickers(titles: string[]): string[] {
  const taken = new Set<string>();
  return titles.map((t) => deriveTicker(t, taken));
}

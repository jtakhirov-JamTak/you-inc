import { cn, formatDollars } from "@/lib/utils";
import type { RegionArea } from "@/lib/price/runner";

// RegionMap — Home's hero. Three regions (Health / Wealth / Relationships), each
// leveling from that area's cumulative DIRECT contribution — the habits + sprints
// tagged to that area (settled board statements + the current week's provisional).
// By design, cross-domain streak / recovery / collapse bonuses are NOT bucketed here
// (a daily streak spans habits in different areas): they move the overall operating
// value shown as the mono line, not a single region's level. Card chrome stays
// neutral cream/ink; only the figure, the progress fill, and the monoline glyph carry
// the region tint. A gold "Sprint · Day d/t" pill appears when an active sprint
// targets that region — the ONLY gold on Home.

// Tunable DISPLAY constant: cents of cumulative contribution per region level.
// 100_000 cents = $1,000 per level. Purely presentational — the authoritative
// operating value stays server-derived; this only paces the level/progress UI.
const LEVEL_STEP = 100_000;

// The three region areas — aliased to the engine's canonical union so the display
// contract can't drift from what getOperatingState produces.
type Area = RegionArea;

export interface RegionView {
  area: Area;
  label: string;
  levelCents: number;
  sprintActive: { dayOfTerm: number; termDays: number } | null;
}

// Per-region tint (glyph stroke + progress fill). Confirmed token classes in
// globals.css: badge-morning/daily/weekly-ink.
const REGION_TINT: Record<Area, string> = {
  health: "text-badge-morning-ink",
  wealth: "text-badge-daily-ink",
  relationships: "text-badge-weekly-ink",
};

// Monoline geometric emblems (currentColor, mirroring app-shell's TabIcon style).
function RegionGlyph({ area, className }: { area: Area; className?: string }) {
  const common = {
    className,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (area) {
    case "health":
      // vitality cross
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <circle cx="10" cy="10" r="6.2" />
          <line x1="10" y1="6.5" x2="10" y2="13.5" />
          <line x1="6.5" y1="10" x2="13.5" y2="10" />
        </svg>
      );
    case "wealth":
      // growth bars
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <line x1="5" y1="14.5" x2="5" y2="11" />
          <line x1="10" y1="14.5" x2="10" y2="7.5" />
          <line x1="15" y1="14.5" x2="15" y2="4.5" />
        </svg>
      );
    case "relationships":
      // two linked circles
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <circle cx="7" cy="10" r="4" />
          <circle cx="13" cy="10" r="4" />
        </svg>
      );
  }
}

function RegionCard({ region }: { region: RegionView }) {
  const tint = REGION_TINT[region.area];
  const cents = Math.max(0, region.levelCents);
  const level = 1 + Math.floor(cents / LEVEL_STEP);
  const progressPct = ((cents % LEVEL_STEP) / LEVEL_STEP) * 100;
  // Figure follows the money tone (green when positive, muted otherwise — NEVER
  // red on Home); the region tint lives on the glyph + progress fill.
  const figureTone = region.levelCents > 0 ? "text-positive" : "text-ink-soft";
  const sprint = region.sprintActive;

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("shrink-0", tint)}>
            <RegionGlyph area={region.area} />
          </span>
          <div className="leading-tight">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-soft">
              Level {level}
            </p>
            <h3 className="mt-0.5 text-[15px] font-bold text-ink">{region.label}</h3>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-mono text-[14px] font-semibold tabular-nums", figureTone)}>
            {formatDollars(cents)}
          </div>
          {sprint && (
            <span className="mt-1 inline-block rounded-[6px] border border-gold-border bg-gold-bg px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-gold-label">
              Sprint · Day {sprint.dayOfTerm} / {sprint.termDays}
            </span>
          )}
        </div>
      </div>

      {/* Progress to next level (reuses the habits progress-bar pattern). */}
      <div
        className="mt-3 h-[5px] overflow-hidden rounded-[3px] bg-divider"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
        aria-label={`${region.label} progress to level ${level + 1}`}
      >
        <div
          className={cn("h-full rounded-[3px] bg-current", tint)}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

export function RegionMap({ regions }: { regions: RegionView[] }) {
  return (
    <section className="mt-5 space-y-2.5" aria-label="Regions">
      {regions.map((r) => (
        <RegionCard key={r.area} region={r} />
      ))}
    </section>
  );
}

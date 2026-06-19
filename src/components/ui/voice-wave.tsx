import { cn } from "@/lib/utils";

// Voice-wave (§4) — 9 accent bars with a gentle infinite alternate scaleY,
// staggered per-bar so they ripple. One of the two ambient motions Storm
// allows (§1); the global prefers-reduced-motion rule freezes the animation,
// leaving the bars static. Purely decorative — aria-hidden.

const BAR_COUNT = 9;
// Static heights (px) give the frozen/reduced-motion state a wave silhouette
// rather than a flat line.
const HEIGHTS = [6, 10, 14, 18, 22, 18, 14, 10, 6];

export function VoiceWave({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex items-center gap-[2px]", className)}
      aria-hidden
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-accent [animation:voicewave_900ms_ease-in-out_infinite_alternate] motion-reduce:animate-none"
          style={{
            height: HEIGHTS[i],
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </span>
  );
}

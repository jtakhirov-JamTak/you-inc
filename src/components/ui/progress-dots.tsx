// Storm progress dots (§4). The current dot widens to ~18px and is accent;
// completed dots are accent; upcoming dots are hairline-strong. Width animates
// over 400ms (stilled under prefers-reduced-motion).
//
// In one-question-per-screen flows these track the ORIGINAL grouping (sections),
// not individual questions — `total` = number of sections, `current` = index of
// the active section. (Redesign §5: "keep any existing grouping only as the
// progress model.")

type Props = {
  total: number;
  current: number;
};

export function ProgressDots({ total, current }: Props) {
  return (
    <div className="flex items-center gap-[5px]" aria-hidden>
      {Array.from({ length: total }).map((_, i) => {
        const isCurrent = i === current;
        const isDoneOrCurrent = i <= current;
        return (
          <div
            key={i}
            className="h-[5px] rounded-full transition-[width,background-color] duration-[400ms] [transition-timing-function:cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
            style={{
              width: isCurrent ? 18 : 5,
              backgroundColor: isDoneOrCurrent
                ? "var(--color-accent)"
                : "var(--color-hairline-strong)",
            }}
          />
        );
      })}
    </div>
  );
}

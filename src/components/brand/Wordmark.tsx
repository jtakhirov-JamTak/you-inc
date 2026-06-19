// Text wordmark for You, Inc. Sized via the `size` prop (font-size in px) so the
// existing call sites (login/signup/landing at larger sizes, app-shell header at
// 15px) keep working. Swap for a logo mark later if the brand gets one.

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="font-display font-medium tracking-[-0.5px] text-ink"
      style={{ fontSize: size, lineHeight: 1 }}
    >
      You,&nbsp;<span className="text-accent-ink">Inc.</span>
    </span>
  );
}

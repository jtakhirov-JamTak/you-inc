"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { Kicker } from "./kicker";
import { PrimaryButton, SecondaryButton } from "./button";
import { useFlowViewport } from "./use-flow-viewport";

/**
 * The no-scroll answering-screen scaffold (redesign §5).
 *
 *   screen : full-screen overlay, sized to the visible viewport band, flex
 *            column, OVERFLOW HIDDEN. Covers the AppShell chrome so an
 *            answering flow takes over the screen.
 *   header : fixed height — back chip · mono eyebrow+counter · progress dots
 *   main   : flex-1, min-h-0, overflow hidden — question title + helper, then
 *            the input region, which fills the remaining space.
 *   footer : fixed — Back (if not first) + primary, above the safe-area inset.
 *
 * Keyboard rule: `useFlowViewport` drives the overlay's height/top off
 * visualViewport so the footer + active field stay visible when the iOS
 * keyboard opens (see that hook). Header and footer stay pinned; only the
 * flex-1 main region absorbs the shrink.
 */
export function FlowScreen({
  header,
  footer,
  title,
  helper,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  /** Question title (the single prompt). Rendered as the screen's h1. */
  title?: ReactNode;
  helper?: ReactNode;
  /** The input region — fills the remaining vertical space. */
  children: ReactNode;
}) {
  const ref = useFlowViewport<HTMLDivElement>();
  // Portal to <body> so the overlay escapes AppShell's `<main>` stacking
  // context (relative z-10). Without this, the screen's z-50 is trapped inside
  // that z-10 layer and the shell's bottom tab bar (z-30, a sibling of main)
  // paints over the footer. Mounted-gated so the server render emits nothing
  // (no document.body on the server / hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Intentional mount gate: flip to client-only on first mount so the portal
    // (which needs document.body) never renders on the server. The one extra
    // render is the whole point — safe to ignore the set-state-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    // Hide the AppShell chrome (top bar + bottom tab bar) while the flow is
    // open. The overlay is a full-screen takeover; the tab bar otherwise pokes
    // through (it lives in its own stacking layer, so z-index alone is not a
    // reliable cover). A hidden element can't overlap regardless of stacking.
    document.body.classList.add("flow-open");
    return () => document.body.classList.remove("flow-open");
  }, []);
  if (!mounted) return null;

  // height/top live as classes for the initial paint, then the hook overrides
  // them imperatively (inline style > class). They are deliberately NOT in the
  // `style` prop: this component re-renders on every keystroke, and React would
  // reconcile a style-prop height/top back to its initial value each render —
  // wiping the keyboard-aware values the hook just set.
  return createPortal(
    <div
      ref={ref}
      className="fixed left-0 right-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <div className="shrink-0 px-5 pt-[max(env(safe-area-inset-top),0.875rem)]">
        {header}
      </div>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-5">
        {title && (
          <h1
            className="shrink-0 text-[22px] font-medium leading-[1.18] text-ink"
            style={{ letterSpacing: "-0.5px" }}
          >
            {title}
          </h1>
        )}
        {helper && (
          <p className="mt-2 shrink-0 text-[12.5px] font-medium leading-[1.45] text-ink-soft">
            {helper}
          </p>
        )}
        <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
      </main>

      <div className="shrink-0 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
        {footer}
      </div>
    </div>,
    document.body,
  );
}

/** Rounded back chip — top-left navigation affordance (§4). */
export function BackChip({
  onClick,
  label = "Back",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-hairline bg-surface text-ink transition active:scale-95"
    >
      <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
    </button>
  );
}

/**
 * Flow header: back chip (left) · eyebrow + counter (center) · progress dots
 * (right). `onBack` always present (exits the flow on the first question).
 */
export function FlowHeader({
  onBack,
  eyebrow,
  counter,
  dots,
}: {
  onBack: () => void;
  eyebrow: string;
  counter: string;
  dots: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <BackChip onClick={onBack} />
      <Kicker className="text-ink-soft">
        {eyebrow} · {counter}
      </Kicker>
      <div className="flex w-10 justify-end">{dots}</div>
    </div>
  );
}

/**
 * Flow footer: Back (secondary, only when `onBack` is provided) + the single
 * primary. The primary's label/handler/disabled come from the consumer so the
 * terminal step can submit while the others advance.
 */
export function FlowFooter({
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  onBack?: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="flex gap-3">
      {onBack && (
        <SecondaryButton onClick={onBack} className="flex-1">
          Back
        </SecondaryButton>
      )}
      <PrimaryButton
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="flex-[2]"
      >
        {primaryLabel}
      </PrimaryButton>
    </div>
  );
}

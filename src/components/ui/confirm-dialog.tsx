"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Accessible confirmation dialog. Centralizes the modal a11y contract so every
// destructive confirm gets it for free (two near-identical copies previously
// had none): role="dialog" + aria-modal, a labelled title + described body,
// Escape to cancel, a focus trap that keeps Tab/Shift+Tab inside the panel, and
// focus restoration to whatever was focused before it opened. Portaled to body
// so it escapes any <main> stacking context (the app-shell tab bar lives
// outside main and would otherwise cover it).
type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Latest-value refs so the open-effect can depend ONLY on `open` (callers pass
  // fresh inline handlers each render; depending on their identity would re-run
  // the effect mid-open and steal focus / re-capture the restore target).
  // Updated in a passive effect (not during render) per react-hooks/refs.
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCancelRef.current = onCancel;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

    // Land keyboard focus inside the dialog (first control = Cancel).
    focusables()[0]?.focus();

    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!busyRef.current) {
          e.preventDefault();
          onCancelRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (active && !panel?.contains(active)) {
        // Focus escaped the dialog — pull it back in.
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger so keyboard/AT users aren't dropped at the
      // top of the page.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // open always starts false, so the portal never renders during SSR/hydration
  // (both sides return null) — no mount-state flag needed.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id={titleId}
          className="font-display text-[22px] font-medium leading-[1.15] text-ink"
        >
          {title}
        </h3>
        <div
          id={descId}
          className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft"
        >
          {description}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-12 flex-1 rounded-pill bg-surface-tint text-[14px] font-semibold text-ink active:opacity-80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            className="h-12 flex-1 rounded-pill bg-danger text-[14px] font-bold text-white active:opacity-90 disabled:opacity-50"
          >
            {busy ? (busyLabel ?? "Working…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard-aware sizing for full-screen answering flows.
 *
 * The problem (CLAUDE.md mobile rule + §5 of the redesign spec): a flow screen
 * is `position: fixed` at `100dvh`. On iOS Safari the soft keyboard does NOT
 * shrink the layout viewport — `100dvh` stays full-height — so a footer pinned
 * to the bottom of the column, and the lower part of a full-height textarea,
 * end up hidden behind the keyboard.
 *
 * The fix: drive the screen element off `window.visualViewport`, which DOES
 * shrink (and offsets) when the keyboard opens. We size the element to the
 * *visible* band (`height = visualViewport.height`) and pin it to the visible
 * band's top (`top = visualViewport.offsetTop`). The header stays at the top of
 * the visible band, the footer stays just above the keyboard, and the flex-1
 * `main` region (which clips with overflow-hidden) absorbs the difference — so
 * the active field and the Back/Next footer remain visible while typing.
 *
 * Falls back to `100dvh` / `top: 0` where `visualViewport` is unavailable
 * (older browsers, SSR). rAF-throttled because visualViewport 'resize'/'scroll'
 * can fire rapidly during the keyboard animation.
 */
export function useFlowViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      // No visualViewport API — best-effort static full height.
      el.style.height = "100dvh";
      el.style.top = "0px";
      return;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      // height: the visible band; top: where that band starts (iOS shifts it
      // up when it scrolls the focused field into view).
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    };
  }, []);

  return ref;
}

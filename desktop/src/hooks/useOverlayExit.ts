import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface UseOverlayExitOptions {
  /** animation-name that marks the exit animation as finished. */
  exitName: string;
  /** Safety fallback (ms) if `animationend` never fires. Should be >= the exit
   * animation's duration. */
  exitMs: number;
}

export interface OverlayExitState {
  /** Feed to the overlay's open/mounted flag — stays true through the exit so
   * the underlying element keeps its open state (focus trap, backdrop). */
  mounted: boolean;
  /** True while the exit animation plays — drive `data-motion-phase="exit"`. */
  exiting: boolean;
  /** Attach to the animating element; finalizes unmount when the exit ends. */
  onAnimationEnd: (event: { animationName: string }) => void;
}

/**
 * Delays an overlay's unmount until its exit animation finishes, giving
 * CSS-only overlays (astryx Dialog, custom drawers) a symmetric enter/exit.
 *
 * `mounted` stays true through the exit; `exiting` drives the exit-phase CSS.
 * Completion is primarily `animationend`, with `exitMs` as a safety fallback in
 * case the element is hidden/removed before the event fires. Under reduced
 * motion the exit is skipped and the overlay unmounts immediately. A reopen
 * mid-exit cancels the exit without a flash or a leaked timer.
 */
export function useOverlayExit(
  open: boolean,
  { exitName, exitMs }: UseOverlayExitOptions,
): OverlayExitState {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `mounted` so the open-driven effect can read the latest value
  // without listing it as a dependency (which would re-run on every toggle).
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const finalize = useCallback(() => {
    clearTimer();
    setExiting(false);
    setMounted(false);
  }, [clearTimer]);

  useEffect(() => {
    if (open) {
      // (Re)opening — cancel any in-flight exit and show immediately.
      clearTimer();
      setMounted(true);
      setExiting(false);
      return;
    }
    // Closing: nothing to animate out if we were never shown.
    if (!mountedRef.current) return;
    if (reduced) {
      clearTimer();
      setExiting(false);
      setMounted(false);
      return;
    }
    setExiting(true);
    clearTimer();
    timer.current = setTimeout(finalize, exitMs + 20);
  }, [open, reduced, exitMs, clearTimer, finalize]);

  // Clear the safety timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  const onAnimationEnd = useCallback(
    (event: { animationName: string }) => {
      if (exiting && event.animationName === exitName) finalize();
    },
    [exiting, exitName, finalize],
  );

  return { mounted, exiting, onAnimationEnd };
}

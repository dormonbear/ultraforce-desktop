import type { UseOverlayExitOptions } from "../../hooks/useOverlayExit";

/**
 * Shared exit config for the app's modal dialogs (MotionDialog + confirm()).
 * `exitMs` must match the `--t-modal-out` / `fjord-dialog-out` duration in
 * motion.css (120ms); keep both in sync if either changes.
 */
export const DIALOG_EXIT: UseOverlayExitOptions = {
  exitName: "fjord-dialog-out",
  exitMs: 120,
} as const;

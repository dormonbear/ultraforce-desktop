import { Play, LoaderCircle } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { runShortcut } from "../platform";

interface Props {
  onRun: () => void;
  running: boolean;
  /** Label shown when idle (default "Run"). */
  label?: string;
  /** Label shown while running (default "Running"). */
  runningLabel?: string;
}

/**
 * Crossfading icon slot: play ⇄ spinner as our own stacked elements.
 *
 * astryx Button's `isLoading` hides ALL button content and shows its own
 * centered spinner (the label disappears). We instead keep the label visible
 * and crossfade only the icon, so "▶ Run" becomes "⟳ Running" (see .run-icon-*
 * in motion.css). The spinner's rotation lives on the inner SVG via `.spin`, so
 * it never collides with the face's opacity/scale transform.
 */
function RunIcon({ running }: { running: boolean }) {
  return (
    <span className="run-icon-slot" aria-hidden="true">
      <span className="run-icon-face" data-visible={!running}>
        <Play size={14} fill="currentColor" />
      </span>
      <span className="run-icon-face" data-visible={running}>
        <LoaderCircle size={14} className="spin" />
      </span>
    </span>
  );
}

/** The primary accent action button shared across tool panels. */
export function RunButton({
  onRun,
  running,
  label = "Run",
  runningLabel = "Running",
}: Props) {
  // aria-busy lives on a wrapper: astryx Button hard-codes `aria-busy` from its
  // own `isLoading` state (spread after our props), so passing it to the Button
  // is clobbered. `isDisabled` reproduces the exact disabled styling the old
  // `isLoading` path already applied and blocks the double-run at astryx's
  // handleClick guard — so a plain `onClick={onRun}` never fires while running.
  return (
    <span aria-busy={running || undefined} className="ml-3 inline-flex">
      <Button
        label={running ? runningLabel : label}
        icon={<RunIcon running={running} />}
        isDisabled={running}
        size="md"
        tooltip={`Run (${runShortcut()})`}
        onClick={onRun}
      />
    </span>
  );
}

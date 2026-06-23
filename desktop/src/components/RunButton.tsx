import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runShortcut } from "../platform";

interface Props {
  onRun: () => void;
  running: boolean;
  /** Label shown when idle (default "RUN"). */
  label?: string;
  /** Label shown while running (default "RUNNING"). */
  runningLabel?: string;
}

/** The primary accent action button shared across tool panels. */
export function RunButton({
  onRun,
  running,
  label = "RUN",
  runningLabel = "RUNNING",
}: Props) {
  return (
    <Button
      type="button"
      onClick={onRun}
      disabled={running}
      title={`Run (${runShortcut()})`}
      className="ml-3 h-8 cursor-pointer gap-1.5 px-3 text-[12px] uppercase tracking-wide disabled:opacity-40"
    >
      {running ? (
        <Loader2 size={14} className="spin" />
      ) : (
        <Play size={14} fill="currentColor" />
      )}
      {running ? runningLabel : label}
    </Button>
  );
}

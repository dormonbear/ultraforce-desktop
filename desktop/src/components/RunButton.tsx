import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      className="focus-accent ml-3 h-8 gap-1.5 rounded-[3px] px-3 text-[12px] font-bold uppercase tracking-wide text-bg transition-transform duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
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

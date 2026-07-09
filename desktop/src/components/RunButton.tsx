import { Play } from "lucide-react";
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

/** The primary accent action button shared across tool panels. */
export function RunButton({
  onRun,
  running,
  label = "Run",
  runningLabel = "Running",
}: Props) {
  return (
    <Button
      label={running ? runningLabel : label}
      icon={<Play size={14} fill="currentColor" />}
      isLoading={running}
      size="md"
      tooltip={`Run (${runShortcut()})`}
      onClick={onRun}
      className="ml-3"
    />
  );
}

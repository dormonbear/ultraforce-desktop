import { Loader2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { useLoggingConfig } from "../useLoggingConfig";
import { TraceFlagsTable } from "./TraceFlagsTable";
import { DebugLevelsTable } from "./DebugLevelsTable";

interface Props {
  org: string | null;
  onClose: () => void;
}

/** IC2-style "Configure Logging" editor, inline in the right panel (replaces
 * the log detail while active): manage trace flags + debug levels. */
export function LoggingConfigPanel({ org, onClose }: Props) {
  const cfg = useLoggingConfig(org);

  const onSave = async () => {
    if (await cfg.save()) onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="micro-label">Configure Logging</div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            label="Cancel"
            onClick={onClose}
            className="cursor-pointer"
          />
          <Button
            variant="primary"
            label={cfg.saving ? "Saving…" : "Save"}
            onClick={onSave}
            isDisabled={cfg.saving || cfg.loading}
            className="cursor-pointer"
          />
        </div>
      </div>

      {cfg.error && (
        <div className="mx-4 mb-2 rounded-md border border-destructive/40 bg-card p-2 text-[12px] text-destructive">
          {cfg.error}
        </div>
      )}

      {cfg.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-text-dim">
          <Loader2 size={16} className="spin" /> Loading trace flags & debug levels…
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <section>
            <div className="micro-label mb-1">Trace Flags</div>
            <TraceFlagsTable cfg={cfg} />
          </section>
          <section>
            <div className="micro-label mb-1">Debug Levels</div>
            <DebugLevelsTable cfg={cfg} />
          </section>
        </div>
      )}
    </div>
  );
}

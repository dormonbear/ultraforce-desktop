import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLoggingConfig } from "../useLoggingConfig";
import { TraceFlagsTable } from "./TraceFlagsTable";
import { DebugLevelsTable } from "./DebugLevelsTable";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: string | null;
}

/** IC2-style "Configure Logging" dialog: manage trace flags + debug levels. */
export function LoggingConfigDialog({ open, onOpenChange, org }: Props) {
  const cfg = useLoggingConfig(org);

  const onSave = async () => {
    if (await cfg.save()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configure Logging</DialogTitle>
        </DialogHeader>

        {cfg.error && (
          <div className="rounded-md border border-destructive/40 bg-card p-2 text-[12px] text-destructive">
            {cfg.error}
          </div>
        )}

        <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
          <section>
            <div className="micro-label mb-1">Trace Flags</div>
            <TraceFlagsTable cfg={cfg} />
          </section>
          <section>
            <div className="micro-label mb-1">Debug Levels</div>
            <DebugLevelsTable cfg={cfg} />
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={cfg.saving} className="cursor-pointer">
            {cfg.saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

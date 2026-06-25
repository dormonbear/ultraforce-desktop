import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SourceRef } from "../panels/sourceRef";

interface ApexSource {
  name: string;
  kind: string;
  body: string;
}

/** Read-only viewer for an Apex class/trigger's source, fetched from the org on
 * open, scrolled to (and highlighting) the target line — "jump to source". */
export function SourceDialog({
  target,
  onClose,
}: {
  target: SourceRef | null;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<ApexSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!target) return;
    setSrc(null);
    setError(null);
    let alive = true;
    invoke<ApexSource>("fetch_apex_source", { name: target.className })
      .then((s) => alive && setSrc(s))
      .catch((e) => alive && setError(typeof e === "string" ? e : String(e)));
    return () => {
      alive = false;
    };
  }, [target]);

  useEffect(() => {
    if (src) lineRef.current?.scrollIntoView({ block: "center" });
  }, [src]);

  const lines = src ? src.body.split("\n") : [];
  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-3">
        <DialogHeader>
          <DialogTitle>
            {target?.className}
            {src ? ` · ${src.kind}` : ""}
            {target?.line != null ? ` · line ${target.line}` : ""}
          </DialogTitle>
        </DialogHeader>
        {!src && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-text-dim">
            <Loader2 className="spin" size={16} /> Fetching source…
          </div>
        )}
        {error && <div className="py-4 text-[12px] text-destructive">{error}</div>}
        {src && (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-card font-mono text-[11px] leading-relaxed">
            {lines.map((l, i) => {
              const n = i + 1;
              const hot = target?.line === n;
              return (
                <div
                  key={i}
                  ref={hot ? lineRef : undefined}
                  className={`flex gap-3 px-2 ${hot ? "bg-primary/15" : ""}`}
                >
                  <span className="w-10 shrink-0 select-none text-right text-text-dim/50">
                    {n}
                  </span>
                  <span className="whitespace-pre text-foreground">{l || " "}</span>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

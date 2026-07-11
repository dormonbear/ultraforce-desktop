import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { barState, phaseLabel, type Progress } from "./indexBar";

/** Shared subscription to the backend `index-progress` stream (null = idle). */
export function useIndexProgress(): Progress | null {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    const un = listen<Progress>("index-progress", (e) => {
      setP(e.payload.phase === "done" ? null : e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);
  return p;
}

/**
 * The 2px strip at the very top of the window. Idle: a static accent bar.
 * While indexing: a progress bar — real percentage during the sObject phase,
 * an indeterminate sweep otherwise.
 */
export function TopProgressBar() {
  const { active, determinate, pct } = barState(useIndexProgress());

  if (!active) return <div className="h-0.5 w-full bg-primary" />;

  return (
    <div className="h-0.5 w-full overflow-hidden bg-primary/20">
      {determinate ? (
        <div
          className="h-full w-full origin-left bg-primary transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      ) : (
        <div className="uf-indeterminate h-full w-1/3 bg-primary" />
      )}
    </div>
  );
}

/** Top-bar text indicator shown while an org is being indexed; hides when done. */
export function IndexProgress() {
  const p = useIndexProgress();
  if (!p) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
      <Loader2 size={12} className="spin" />
      {phaseLabel(p)}
    </span>
  );
}

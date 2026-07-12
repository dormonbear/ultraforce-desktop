import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { useOrgs } from "../org";
import { indexStatus } from "../ipc/schema";
import { barState, phaseLabel, type Progress } from "./indexBar";

/**
 * Progress for the currently selected org's index. Scoped by org so a stale
 * in-flight run for a previously selected org can't drive this indicator. Seeds
 * from the queryable `index_status` on mount / org-change (fixing the old
 * late-subscriber gap where an index already in flight emitted no more events),
 * then tracks the `index-progress` stream. `null` = idle/ready.
 */
export function useIndexProgress(): Progress | null {
  const { selected } = useOrgs();
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    setP(null);
    if (!selected) return;
    let alive = true;
    // Seed from the queryable snapshot in case a run is already in flight.
    void indexStatus(selected)
      .then((s) => {
        if (alive && s.state === "indexing")
          setP({
            org: s.org,
            phase: s.phase ?? "",
            done: s.done ?? 0,
            total: s.total ?? 0,
          });
      })
      .catch(() => {});
    const un = listen<Progress>("index-progress", (e) => {
      if (e.payload.org !== selected) return; // ignore other orgs' runs
      setP(e.payload.phase === "done" ? null : e.payload);
    });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, [selected]);
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
          className="h-full w-full origin-left bg-primary transition-transform duration-300 ease-[var(--ease)]"
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
    <span className="tnum flex items-center gap-1.5 text-[11px] text-text-dim">
      <Loader2 size={12} className="spin" />
      {phaseLabel(p)}
    </span>
  );
}

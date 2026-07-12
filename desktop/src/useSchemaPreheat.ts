import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { indexStatus } from "./ipc/schema";
import type { IndexStatus } from "./types";

/** A cancellable idle-scheduled callback. */
interface IdleHandle {
  cancel: () => void;
}

/**
 * Schedule `cb` for the browser's idle time, falling back to a short timeout
 * where `requestIdleCallback` is unavailable (e.g. WebKit). Only the *start* is
 * deferred — the callback itself does one React commit.
 */
function scheduleIdle(cb: () => void): IdleHandle {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 2000 });
    return { cancel: () => w.cancelIdleCallback?.(id) };
  }
  const id = window.setTimeout(cb, 200);
  return { cancel: () => window.clearTimeout(id) };
}

/**
 * Pre-mount the (hidden) Schema panel during idle time so the first click into
 * Schema is near-instant — only Schema; SOQL/Apex/Logs are never preheated here.
 *
 * Gated on the IndexCoordinator: `onReady` fires only when the selected org's
 * index is `ready`. While it is idle / indexing / errored we hold off and wait
 * for the org's next `index-progress` "done" event, then re-check — so a reindex
 * that finishes later still triggers the preheat (no dead "never preheated"
 * state). An org change (or `enabled` going false once preheated) tears the
 * effect down, cancelling any pending idle callback and dropping the listener,
 * so a stale org's index can never preheat the panel for a newly selected one.
 */
export function useSchemaPreheat(
  org: string | null,
  enabled: boolean,
  onReady: () => void,
): void {
  useEffect(() => {
    if (!enabled || !org) return;
    let cancelled = false;
    let idle: IdleHandle | null = null;

    const fire = () => {
      if (cancelled) return;
      idle?.cancel();
      idle = scheduleIdle(() => {
        if (!cancelled) onReady();
      });
    };

    const evaluate = (status: IndexStatus) => {
      if (cancelled || status.state !== "ready") return;
      fire();
    };

    // Seed from the queryable snapshot (covers a run that finished before this
    // effect mounted its listener), then track completion events.
    void indexStatus(org).then(evaluate).catch(() => {});
    const un = listen<{ org: string; phase: string }>("index-progress", (e) => {
      if (e.payload.org !== org || e.payload.phase !== "done") return;
      void indexStatus(org).then(evaluate).catch(() => {});
    });

    return () => {
      cancelled = true;
      idle?.cancel();
      void un.then((f) => f());
    };
  }, [org, enabled, onReady]);
}

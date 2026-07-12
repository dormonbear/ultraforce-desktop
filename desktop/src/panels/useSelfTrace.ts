import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatIpcError } from "../errorFormat";
import {
  getDebugConfig,
  quickSelfTrace as requestSelfTrace,
} from "../ipc/config";

/** Self-trace state: whether a TraceFlag on the running user is active, a live
 * minutes-left countdown, and the one-click "trace me for 30 min" action.
 *
 * `active` is whether the Logs panel is the visible tool. The countdown tick is
 * paused while Logs is hidden so the memoized panel isn't re-rendered every 30s
 * in the background; on re-activation `now` is refreshed so the minutes-left
 * countdown can't show a stale value after being paused. */
export function useSelfTrace(org: string | null, active = true) {
  const [tracingBusy, setTracingBusy] = useState(false);
  // Active self-trace ExpirationDate (from the running user's TraceFlag); drives
  // the live "Tracing · Nm" state on the button. `now` ticks to recompute it.
  const [traceExpiry, setTraceExpiry] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Show whether a self-trace is already active (and refresh its expiry).
  useEffect(() => {
    getDebugConfig(org)
      .then((dto) => setTraceExpiry(dto.expirationDate))
      .catch(() => {});
  }, [org]);

  // Tick so the countdown re-renders; 30s is fine for minute granularity. Only
  // ticks while Logs is visible; re-activation refreshes `now` immediately so a
  // paused countdown never shows a stale minutes-left after the panel reshows.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);

  const traceMsLeft = traceExpiry ? new Date(traceExpiry).getTime() - now : 0;
  const tracing = traceMsLeft > 0;
  const traceMinsLeft = Math.max(1, Math.ceil(traceMsLeft / 60_000));

  const quickSelfTrace = useCallback(async () => {
    if (tracingBusy) return;
    setTracingBusy(true);
    try {
      const dto = await requestSelfTrace(30, org);
      setTraceExpiry(dto.expirationDate);
      setNow(Date.now());
      toast.success("Tracing you for 30 min");
    } catch (e) {
      toast.error(`Trace failed: ${formatIpcError(e)}`);
    } finally {
      setTracingBusy(false);
    }
  }, [tracingBusy, org]);

  return { tracing, tracingBusy, traceExpiry, traceMinsLeft, quickSelfTrace };
}

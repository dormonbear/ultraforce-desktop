import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatIpcError } from "../errorFormat";
import { browserLocale, translate } from "../i18n";
import {
  getDebugConfig,
  quickSelfTrace as requestSelfTrace,
} from "../ipc/config";

type TraceState = { org: string | null; expiry: string | null; busy: boolean };
const emptyState = (org: string | null): TraceState => ({ org, expiry: null, busy: false });

/** Owns self-trace feedback for the current org; hidden panels pause the countdown.
 * 管理当前组织的自身跟踪反馈；隐藏面板时暂停倒计时。
 * Backend requests retain their original target; obsolete results cannot publish.
 * 后端请求保留原目标；过期结果不可发布。 */
export function useSelfTrace(org: string | null, active = true) {
  const [state, setState] = useState(() => emptyState(org));
  const generation = useRef(0);
  const owner = useRef({ org, active: false, busy: false });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    owner.current = { org, active: true, busy: false };
    const request = ++generation.current;
    setState(emptyState(org));
    getDebugConfig(org)
      .then((dto) => {
        if (generation.current === request) {
          setState({ org, expiry: dto.expirationDate, busy: false });
          setNow(Date.now());
        }
      })
      .catch(() => {});
    return () => {
      owner.current.active = false;
      generation.current++;
    };
  }, [org]);

  // Refresh immediately on activation, then every 30 seconds. / 激活时立即刷新，之后每 30 秒刷新。
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);

  const current = state.org === org ? state : emptyState(org);
  const traceExpiry = current.expiry;
  const tracingBusy = current.busy;
  const traceMsLeft = traceExpiry ? new Date(traceExpiry).getTime() - now : 0;
  const tracing = traceMsLeft > 0;
  const traceMinsLeft = Math.max(1, Math.ceil(traceMsLeft / 60_000));

  const quickSelfTrace = useCallback(async () => {
    if (!owner.current.active || owner.current.org !== org || owner.current.busy) return;
    owner.current.busy = true;
    const request = ++generation.current;
    setState((previous) => ({ ...(previous.org === org ? previous : emptyState(org)), busy: true }));
    try {
      const dto = await requestSelfTrace(30, org);
      if (generation.current !== request) return;
      setState({ org, expiry: dto.expirationDate, busy: false });
      setNow(Date.now());
      toast.success(translate(browserLocale(), "Tracing you for 30 min"));
    } catch (e) {
      if (generation.current !== request) return;
      setState((previous) => ({ ...previous, busy: false }));
      toast.error(translate(browserLocale(), "Trace failed: {error}", { error: formatIpcError(e) }));
    } finally {
      if (generation.current === request) owner.current.busy = false;
    }
  }, [org]);

  return { tracing, tracingBusy, traceExpiry, traceMinsLeft, quickSelfTrace };
}

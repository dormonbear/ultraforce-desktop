import { formatIpcError } from "./errorFormat";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getDebugConfig, setDebugConfig } from "./ipc/config";
import type { CategoryLevels } from "./types";

type ConfigState = {
  org: string | null;
  levels: CategoryLevels | null;
  applying: boolean;
  error: string | null;
};

const emptyState = (org: string | null): ConfigState => ({ org, levels: null, applying: false, error: null });

/**
 * Owns the selected org's TraceFlag / DebugLevel state and feedback.
 * 管理所选组织的 TraceFlag／DebugLevel 状态及反馈。
 * Only the current UI request publishes; backend writes retain their original org.
 * 仅当前 UI 请求可发布；后端写入保留原组织。
 */
export function useDebugConfig(org: string | null): {
  levels: CategoryLevels | null;
  applying: boolean;
  error: string | null;
  apply: (next: CategoryLevels) => void;
} {
  const [state, setState] = useState(() => emptyState(org));
  const generation = useRef(0);
  const owner = useRef({ org, active: false });

  useEffect(() => {
    owner.current = { org, active: true };
    const request = ++generation.current;
    setState(emptyState(org));
    getDebugConfig(org)
      .then((dto) => {
        if (generation.current === request) {
          setState({ org, levels: dto.levels, applying: false, error: null });
        }
      })
      .catch((e) => {
        if (generation.current === request) {
          setState({ ...emptyState(org), error: formatIpcError(e) });
        }
      });
    return () => {
      owner.current.active = false;
      generation.current++;
    };
  }, [org]);

  const apply = useCallback(async (next: CategoryLevels) => {
    if (!owner.current.active || owner.current.org !== org) return;
    const request = ++generation.current;
    setState({ org, levels: next, applying: true, error: null });
    try {
      const dto = await setDebugConfig(next, org);
      if (generation.current === request) {
        setState({ org, levels: dto.levels, applying: false, error: null });
      }
    } catch (e) {
      if (generation.current !== request) return;
      const message = formatIpcError(e);
      setState({ org, levels: next, applying: false, error: message });
      toast.error(`Debug config: ${message}`);
    }
  }, [org]);

  // Mask the previous org even before its replacement effect runs. / 即使替代 effect 尚未执行，也隐藏前一组织。
  const { levels, applying, error } = state.org === org ? state : emptyState(org);
  return { levels, applying, error, apply };
}

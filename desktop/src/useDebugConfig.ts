import { formatIpcError } from "./errorFormat";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getDebugConfig, setDebugConfig } from "./ipc/config";
import type { CategoryLevels } from "./types";

/**
 * Owns the running user's TraceFlag / DebugLevel config for a panel.
 *
 * Fetches `get_debug_config` on mount and whenever `org` changes, scoping both
 * the read and the `set_debug_config` write to `org` explicitly. Shared by the
 * Apex and Logs panels so the wiring lives in one place.
 */
export function useDebugConfig(org: string | null): {
  levels: CategoryLevels | null;
  applying: boolean;
  error: string | null;
  apply: (next: CategoryLevels) => void;
} {
  const [levels, setLevels] = useState<CategoryLevels | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDebugConfig(org)
      .then((dto) => setLevels(dto.levels))
      .catch((e) => setError(formatIpcError(e)));
  }, [org]);

  const apply = useCallback(async (next: CategoryLevels) => {
    setApplying(true);
    setError(null);
    setLevels(next);
    try {
      const dto = await setDebugConfig(next, org);
      setLevels(dto.levels);
    } catch (e) {
      const message = formatIpcError(e);
      setError(message);
      toast.error(`Debug config: ${message}`);
    } finally {
      setApplying(false);
    }
  }, [org]);

  return { levels, applying, error, apply };
}

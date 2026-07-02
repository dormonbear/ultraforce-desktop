import { formatIpcError } from "./errorFormat";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { CategoryLevels, DebugConfigDto } from "./types";

/**
 * Owns the running user's TraceFlag / DebugLevel config for a panel.
 *
 * Fetches `get_debug_config` on mount and whenever `org` changes (the backend
 * reads the current target org, set globally on org-select — `org` is only the
 * re-fetch trigger). `apply` writes via `set_debug_config`. Shared by the Apex
 * and Logs panels so the wiring lives in one place.
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
    invoke<DebugConfigDto>("get_debug_config")
      .then((dto) => setLevels(dto.levels))
      .catch((e) => setError(formatIpcError(e)));
  }, [org]);

  const apply = useCallback(async (next: CategoryLevels) => {
    setApplying(true);
    setError(null);
    setLevels(next);
    try {
      const dto = await invoke<DebugConfigDto>("set_debug_config", {
        levels: next,
      });
      setLevels(dto.levels);
    } catch (e) {
      const message = formatIpcError(e);
      setError(message);
      toast.error(`Debug config: ${message}`);
    } finally {
      setApplying(false);
    }
  }, []);

  return { levels, applying, error, apply };
}

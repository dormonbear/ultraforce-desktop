import { formatIpcError } from "../errorFormat";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { loadLoggingConfig } from "../ipc/config";
import { CATEGORY_FIELDS, LOG_LEVELS } from "../debug-presets";
import type { CategoryLevels, DebugLevelDto } from "../types";

interface DebugConfigRowProps {
  org: string | null;
  value: CategoryLevels;
  onApply: (levels: CategoryLevels) => void;
  applying: boolean;
  error: string | null;
  /** Controlled by the toolbar toggle; renders nothing when closed. */
  open: boolean;
}

// Native <select> (compact), matching the apex-log DebugLevelsTable style.
const SEL =
  "native-select h-6 cursor-pointer rounded border border-border bg-card px-1 text-[11px] text-foreground focus-accent";

function sameLevels(a: CategoryLevels, b: CategoryLevels): boolean {
  return CATEGORY_FIELDS.every(({ key }) => a[key] === b[key]);
}

/** Returns the org DebugLevel record whose levels match `value`, or null. */
function matchingDebugLevel(
  levels: DebugLevelDto[],
  value: CategoryLevels,
): DebugLevelDto | null {
  return levels.find((d) => sameLevels(d.levels, value)) ?? null;
}

// Cache org DebugLevel records per org so re-expanding doesn't re-hit the org.
// ponytail: no invalidation; stale until app reload if levels change elsewhere.
const levelsCache = new Map<string, DebugLevelDto[]>();

export function DebugConfigRow({
  org,
  value,
  onApply,
  applying,
  error,
  open,
}: DebugConfigRowProps) {
  const [orgLevels, setOrgLevels] = useState<DebugLevelDto[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);
  const [levelsError, setLevelsError] = useState<string | null>(null);

  // Load the org's DebugLevel records; cached per org. `force` bypasses the
  // cache to pick up levels added in the org (or elsewhere in the app).
  const loadLevels = useCallback(
    async (force: boolean) => {
      const cacheKey = org ?? "";
      if (!force) {
        const cached = levelsCache.get(cacheKey);
        if (cached) {
          setOrgLevels(cached);
          return;
        }
      }
      setLoadingLevels(true);
      setLevelsError(null);
      try {
        const cfg = await loadLoggingConfig(org);
        levelsCache.set(cacheKey, cfg.debugLevels);
        setOrgLevels(cfg.debugLevels);
      } catch (e) {
        setLevelsError(formatIpcError(e));
      } finally {
        setLoadingLevels(false);
      }
    },
    [org],
  );

  // Fetch when first opened, and whenever the org changes while open.
  useEffect(() => {
    if (open) void loadLevels(false);
  }, [open, loadLevels]);

  if (!open) return null;

  const active = matchingDebugLevel(orgLevels, value);

  const setLevel = (key: keyof CategoryLevels, level: string) => {
    onApply({ ...value, [key]: level });
  };

  return (
    <div className="border-b border-border bg-card/60 px-4 py-2">
      {(applying || error) && (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-[11px]">
          {applying && (
            <span className="inline-flex items-center gap-1 text-text-dim">
              <Loader2 size={12} className="animate-spin text-primary" />
              applying
            </span>
          )}
          {error && <span className="truncate text-destructive">{error}</span>}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[11px]">
          <thead className="text-text-dim">
            <tr className="border-b border-border">
              <th className="px-2 py-0.5 text-left font-normal">Preset</th>
              {CATEGORY_FIELDS.map(({ key, label }) => (
                <th
                  key={key}
                  className="whitespace-nowrap px-1 py-0.5 text-left font-normal"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-0.5">
                <div className="flex items-center gap-1">
                  <select
                    aria-label="Debug level preset"
                    className={`${SEL} w-36`}
                    value={active?.id ?? ""}
                    disabled={loadingLevels || orgLevels.length === 0}
                    onChange={(e) => {
                      const d = orgLevels.find((x) => x.id === e.target.value);
                      if (d) onApply(d.levels);
                    }}
                  >
                    {!active && (
                      <option value="" disabled>
                        {loadingLevels
                          ? "Loading…"
                          : orgLevels.length === 0
                            ? "No debug levels"
                            : "Custom"}
                      </option>
                    )}
                    {orgLevels.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.developerName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Refresh debug levels"
                    disabled={loadingLevels}
                    onClick={() => void loadLevels(true)}
                    className="focus-accent inline-flex size-6 shrink-0 items-center justify-center rounded text-text-dim hover:text-foreground disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={12} className={loadingLevels ? "animate-spin" : ""} />
                  </button>
                </div>
              </td>
              {CATEGORY_FIELDS.map(({ key, label }) => (
                <td key={key} className="px-1 py-0.5">
                  <select
                    aria-label={`${label} debug level`}
                    className={`${SEL} w-[4.5rem]`}
                    value={value[key]}
                    onChange={(e) => setLevel(key, e.target.value)}
                  >
                    {LOG_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {levelsError && (
          <div className="border-t border-border px-2 py-1 text-[11px] text-destructive">
            {levelsError}
          </div>
        )}
      </div>
    </div>
  );
}

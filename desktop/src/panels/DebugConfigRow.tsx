import { Loader2, RefreshCw } from "lucide-react";
import { CATEGORY_FIELDS, LOG_LEVELS } from "../debug-presets";
import type { CategoryLevels, DebugLevelDto } from "../types";
import { useDebugPresets } from "../useDebugPresets";
import { useI18n } from "../i18n";

interface DebugConfigRowProps {
  org: string | null;
  value: CategoryLevels | null;
  onApply: (levels: CategoryLevels) => void;
  applying: boolean;
  error: string | null;
  /** Toggles controls; current config-load errors remain visible. / 切换控件；当前配置加载错误仍保持可见。 */
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

function DebugPresetPicker({ records, loading, value, onApply, onRefresh }: {
  records: DebugLevelDto[];
  loading: boolean;
  value: CategoryLevels;
  onApply: (levels: CategoryLevels) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const active = matchingDebugLevel(records, value);
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={t("Debug level preset")}
        className={`${SEL} w-36`}
        value={active?.id ?? ""}
        disabled={loading || records.length === 0}
        onChange={(event) => {
          const selected = records.find(record => record.id === event.target.value);
          if (selected) onApply(selected.levels);
        }}
      >
        {!active && <option value="" disabled>{loading ? t("Loading…") : records.length === 0 ? t("No debug levels") : t("Custom")}</option>}
        {records.map(record => <option key={record.id} value={record.id}>{record.developerName}</option>)}
      </select>
      <button
        type="button"
        aria-label={t("Refresh debug levels")}
        disabled={loading}
        onClick={onRefresh}
        className="focus-accent inline-flex size-6 shrink-0 items-center justify-center rounded text-text-dim hover:text-foreground disabled:opacity-50 cursor-pointer"
      >
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  );
}

export function DebugConfigRow({
  org,
  value,
  onApply,
  applying,
  error,
  open,
}: DebugConfigRowProps) {
  const { t } = useI18n();
  const { records: orgLevels, loading: loadingLevels, error: levelsError, refresh } = useDebugPresets(org, open && value !== null);

  if (!value) {
    return error ? (
      <div role="alert" className="border-b border-border px-4 py-2 text-[11px] text-destructive">
        {error}
      </div>
    ) : null;
  }

  if (!open) return null;

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
              {t("Applying…")}
            </span>
          )}
          {error && <span className="truncate text-destructive">{error}</span>}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[11px]">
          <thead className="text-text-dim">
            <tr className="border-b border-border">
              <th className="px-2 py-0.5 text-left font-normal">{t("Preset")}</th>
              {CATEGORY_FIELDS.map(({ key, label }) => (
                <th
                  key={key}
                  className="whitespace-nowrap px-1 py-0.5 text-left font-normal"
                >
                  {t(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-0.5">
                <DebugPresetPicker records={orgLevels} loading={loadingLevels} value={value} onApply={onApply} onRefresh={refresh} />
              </td>
              {CATEGORY_FIELDS.map(({ key, label }) => (
                <td key={key} className="px-1 py-0.5">
                  <select
                    aria-label={t("{category} debug level", { category: t(label) })}
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

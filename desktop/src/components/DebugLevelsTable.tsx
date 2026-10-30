import { Plus, Trash2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  CATEGORY_FIELDS,
  LOG_LEVELS,
  matchingPreset,
  PRESET_NAMES,
  presetLevels,
  type PresetName,
} from "../debug-presets";
import type { CategoryLevels } from "../types";
import type { useLoggingConfig } from "../useLoggingConfig";
import { useI18n } from "../i18n";

type Cfg = ReturnType<typeof useLoggingConfig>;

// Native <select> (light + compact): the dense 11-column grid renders hundreds
// of these, where Radix Select would freeze the dialog.
const SEL =
  "native-select h-6 cursor-pointer rounded border border-border bg-card px-1 text-[11px] text-foreground focus-accent";

/** Editable table of DebugLevel records: name, a preset quick-fill, and the 11
 * category levels laid out inline (IC2-style). */
export function DebugLevelsTable({ cfg }: { cfg: Cfg }) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-0.5">
        <span className="text-[11px] text-text-dim">{t("{count} level(s)", { count: cfg.levels.length })}</span>
        <Button
          variant="ghost"
          size="sm"
          label={t("Add Debug Level")}
          aria-label={t("Add debug level")}
          icon={<Plus size={12} />}
          onClick={cfg.addLevel}
          className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
        />
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-text-dim">
          <tr className="border-b border-border">
            <th className="px-2 py-0.5 text-left font-normal">{t("Name")}</th>
            <th className="px-2 py-0.5 text-left font-normal">{t("Preset")}</th>
            {CATEGORY_FIELDS.map(({ key, label }) => (
              <th key={key} className="whitespace-nowrap px-1 py-0.5 text-left font-normal">
                {t(label)}
              </th>
            ))}
            <th className="w-7" />
          </tr>
        </thead>
        <tbody>
          {cfg.levels.map((r) => {
            const preset = matchingPreset(r.levels);
            return (
              <tr key={r._key} className="border-b border-border/60">
                <td className="px-2 py-0.5">
                  {r.id ? (
                    <span className="whitespace-nowrap text-foreground">{r.developerName}</span>
                  ) : (
                    <TextInput
                      label={t("Debug level name")}
                      isLabelHidden
                      value={r.developerName}
                      onChange={(value) => cfg.updateLevel(r._key, { developerName: value })}
                      size="sm"
                      width={144}
                      className="text-[11px]"
                    />
                  )}
                </td>
                <td className="px-2 py-0.5">
                  <select
                    aria-label={t("Debug level preset")}
                    className={`${SEL} w-28`}
                    value={preset ?? ""}
                    onChange={(e) =>
                      cfg.updateLevel(r._key, { levels: presetLevels(e.target.value as PresetName) })
                    }
                  >
                    {preset === null && (
                      <option value="" disabled>
                        {t("Custom")}
                      </option>
                    )}
                    {PRESET_NAMES.map((n) => (
                      <option key={n} value={n}>
                        {t(n)}
                      </option>
                    ))}
                  </select>
                </td>
                {CATEGORY_FIELDS.map(({ key, label }) => (
                  <td key={key} className="px-1 py-0.5">
                    <select
                      aria-label={t(label)}
                      className={`${SEL} w-[4.5rem]`}
                      value={r.levels[key]}
                      onChange={(e) =>
                        cfg.updateLevel(r._key, {
                          levels: { ...r.levels, [key]: e.target.value as CategoryLevels[typeof key] },
                        })
                      }
                    >
                      {LOG_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td className="px-1 py-0.5">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={t("Remove debug level")}
                    icon={<Trash2 size={12} />}
                    onClick={() => cfg.removeLevel(r._key)}
                    className="size-6 cursor-pointer text-text-dim hover:text-destructive"
                  />
                </td>
              </tr>
            );
          })}
          {cfg.levels.length === 0 && (
            <tr>
              <td colSpan={CATEGORY_FIELDS.length + 3} className="px-2 py-3 text-center text-text-dim">
                {t("No debug levels")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

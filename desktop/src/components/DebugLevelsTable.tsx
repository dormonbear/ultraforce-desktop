import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchingPreset, PRESET_NAMES, presetLevels, type PresetName } from "../debug-presets";
import type { useLoggingConfig } from "../useLoggingConfig";

type Cfg = ReturnType<typeof useLoggingConfig>;

/** Editable table of DebugLevel records. Levels are set via a preset. */
export function DebugLevelsTable({ cfg }: { cfg: Cfg }) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] text-text-dim">{cfg.levels.length} level(s)</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Add debug level"
          onClick={cfg.addLevel}
          className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
        >
          <Plus size={12} /> Add Debug Level
        </Button>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-text-dim">
          <tr className="border-b border-border">
            <th className="px-2 py-1 text-left font-normal">Developer Name</th>
            <th className="px-2 py-1 text-left font-normal">Preset</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {cfg.levels.map((r) => {
            const preset = matchingPreset(r.levels);
            return (
              <tr key={r._key} className="border-b border-border/60">
                <td className="px-2 py-1">
                  {r.id ? (
                    <span className="text-foreground">{r.developerName}</span>
                  ) : (
                    <Input
                      aria-label="Debug level name"
                      value={r.developerName}
                      onChange={(e) => cfg.updateLevel(r._key, { developerName: e.target.value })}
                      className="h-7 text-[12px]"
                    />
                  )}
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={preset ?? undefined}
                    onValueChange={(name) =>
                      cfg.updateLevel(r._key, { levels: presetLevels(name as PresetName) })
                    }
                  >
                    <SelectTrigger
                      aria-label="Debug level preset"
                      className="h-7 w-40 text-[12px]"
                    >
                      <SelectValue placeholder="Custom" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESET_NAMES.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-1 py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove debug level"
                    onClick={() => cfg.removeLevel(r._key)}
                    className="size-7 cursor-pointer text-text-dim hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            );
          })}
          {cfg.levels.length === 0 && (
            <tr>
              <td colSpan={3} className="px-2 py-3 text-center text-text-dim">
                — no debug levels —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

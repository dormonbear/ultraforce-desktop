import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORY_FIELDS,
  LOG_LEVELS,
  matchingPreset,
  PRESET_NAMES,
  presetLevels,
  type PresetName,
} from "../debug-presets";
import type { CategoryLevels } from "../types";

interface DebugConfigRowProps {
  value: CategoryLevels;
  onApply: (levels: CategoryLevels) => void;
  applying: boolean;
  error: string | null;
}

function PresetMenu({
  value,
  onChoose,
}: {
  value: PresetName | null;
  onChoose: (name: PresetName) => void;
}) {
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(name) => onChoose(name as PresetName)}
    >
      <SelectTrigger
        aria-label="Select debug preset"
        className="focus-accent h-7 w-44 cursor-pointer rounded-[3px] border-hair bg-surface px-2.5 text-[12px] text-text-dim transition-colors hover:text-text"
      >
        <SelectValue placeholder="Custom" />
      </SelectTrigger>
      <SelectContent className="rounded-[3px] border-hair bg-surface text-[12px]">
        {PRESET_NAMES.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DebugConfigRow({
  value,
  onApply,
  applying,
  error,
}: DebugConfigRowProps) {
  const [open, setOpen] = useState(false);
  const activePreset = matchingPreset(value);

  const setLevel = (key: keyof CategoryLevels, level: string) => {
    onApply({ ...value, [key]: level });
  };

  return (
    <div className="border-y border-hair bg-surface/60 px-4 py-2">
      <button
        type="button"
        aria-label="Toggle debug levels"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-accent flex w-full cursor-pointer items-center gap-3 rounded-[3px] py-1 text-left"
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="micro-label min-w-[118px] shrink-0">DEBUG LEVELS</span>
        <span className="text-[12px] text-text">{activePreset ?? "Custom"}</span>
        <span className="ml-auto flex min-w-0 items-center gap-2 text-[11px]">
          {applying && (
            <span className="inline-flex items-center gap-1 text-text-dim">
              <Loader2 size={12} className="animate-spin text-primary" />
              applying
            </span>
          )}
          {error && <span className="truncate text-red">{error}</span>}
        </span>
      </button>

      {open && (
        <div className="mt-2 grid gap-2 border-t border-hair pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro-label w-24 shrink-0">PRESET</span>
            <PresetMenu
              value={activePreset}
              onChoose={(name) => onApply(presetLevels(name))}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-[11px] uppercase text-text-dim">
                  {label}
                </span>
                <Select
                  value={value[key]}
                  onValueChange={(level) => setLevel(key, level)}
                >
                  <SelectTrigger
                  aria-label={`${label} debug level`}
                    className="focus-accent h-7 min-w-0 flex-1 cursor-pointer rounded-[3px] border-hair bg-surface px-2 text-[12px] text-text"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-[3px] border-hair bg-surface text-[12px]">
                    {LOG_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

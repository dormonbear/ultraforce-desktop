import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Select debug preset"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown") setOpen(true);
        }}
        className="focus-accent inline-flex h-7 cursor-pointer items-center gap-2 rounded-[3px] border border-hair bg-surface px-2.5 text-[12px] text-text-dim transition-colors hover:text-text"
      >
        <span>{value ?? "Custom"}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-40 mt-1 w-44 overflow-hidden rounded-[3px] border border-hair bg-surface py-1 text-[12px] shadow-lg"
        >
          {PRESET_NAMES.map((name) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={name === value}
                onClick={() => {
                  onChoose(name);
                  setOpen(false);
                }}
                className={`focus-accent nav-state-active flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-hair/40 ${
                  name === value ? "text-accent" : "text-text"
                }`}
              >
                <span>{name}</span>
                {name === value && <Check size={12} className="text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
              <Loader2 size={12} className="animate-spin text-accent" />
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
                <select
                  aria-label={`${label} debug level`}
                  value={value[key]}
                  onChange={(e) => setLevel(key, e.target.value)}
                  className="focus-accent h-7 min-w-0 flex-1 cursor-pointer rounded-[3px] border border-hair bg-surface px-2 text-[12px] text-text"
                >
                  {LOG_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

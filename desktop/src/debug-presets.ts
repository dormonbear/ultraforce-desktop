import type { CategoryLevels } from "./types";

export const LOG_LEVELS = [
  "NONE",
  "ERROR",
  "WARN",
  "INFO",
  "FINE",
  "FINER",
  "FINEST",
  "DEBUG",
] as const;

export const CATEGORY_FIELDS = [
  { key: "apexCode", label: "Apex Code" },
  { key: "apexProfiling", label: "Apex Profiling" },
  { key: "callout", label: "Callout" },
  { key: "dataAccess", label: "Data Access" },
  { key: "database", label: "Database" },
  { key: "nba", label: "Nba" },
  { key: "system", label: "System" },
  { key: "validation", label: "Validation" },
  { key: "visualforce", label: "Visualforce" },
  { key: "wave", label: "Wave" },
  { key: "workflow", label: "Workflow" },
] as const satisfies readonly { key: keyof CategoryLevels; label: string }[];

export const PRESET_NAMES = ["None", "Apex Only", "Full Debugging"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

const ALL_NONE: CategoryLevels = {
  apexCode: "NONE",
  apexProfiling: "NONE",
  callout: "NONE",
  dataAccess: "NONE",
  database: "NONE",
  nba: "NONE",
  system: "NONE",
  validation: "NONE",
  visualforce: "NONE",
  wave: "NONE",
  workflow: "NONE",
};

const PRESETS: Record<PresetName, CategoryLevels> = {
  None: ALL_NONE,
  "Apex Only": {
    ...ALL_NONE,
    apexCode: "DEBUG",
    system: "DEBUG",
  },
  "Full Debugging": {
    apexCode: "FINEST",
    apexProfiling: "FINEST",
    callout: "FINEST",
    dataAccess: "FINEST",
    database: "FINEST",
    nba: "FINE",
    system: "FINE",
    validation: "INFO",
    visualforce: "FINER",
    wave: "FINER",
    workflow: "FINER",
  },
};

export function presetLevels(name: PresetName): CategoryLevels {
  return { ...PRESETS[name] };
}

export function matchingPreset(levels: CategoryLevels): PresetName | null {
  return (
    PRESET_NAMES.find((name) =>
      CATEGORY_FIELDS.every(({ key }) => PRESETS[name][key] === levels[key])
    ) ?? null
  );
}

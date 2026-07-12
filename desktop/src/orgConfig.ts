import { flush, getJson, setJson } from "./store";
import type { OrgConfig, OrgDto } from "./types";

/**
 * Per-org config, persisted in the shared tauri-plugin-store file under
 * `orgConfig.<username>`. The Rust side reads the same key from the same store,
 * so a write here (flushed) is visible to the backend immediately.
 */

/** Store key for one org's config. Kept in sync with the Rust side (org_config.rs). */
export function orgConfigKey(username: string): string {
  return `orgConfig.${username}`;
}

/** Read one org's persisted config (empty object when unset). */
export function getOrgConfig(username: string): Promise<OrgConfig> {
  return getJson<OrgConfig>(orgConfigKey(username), {});
}

/** Persist one org's config and flush to disk so the backend reads the fresh value. */
export async function setOrgConfig(
  username: string,
  config: OrgConfig,
): Promise<void> {
  await setJson(orgConfigKey(username), config);
  await flush();
}

/**
 * Normalize a user-entered API version to Salesforce's `NN.0` form.
 * Accepts a bare integer (`58` → `58.0`) or an already-suffixed `NN.0`
 * (`58.0` → `58.0`); returns `null` for anything else (empty, `58.5`, letters).
 */
export function normalizeApiVersion(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{1,3}$/.test(s)) return `${parseInt(s, 10)}.0`;
  if (/^\d{1,3}\.0$/.test(s)) return `${parseInt(s, 10)}.0`;
  return null;
}

/**
 * Parse a user-entered timeout (whole positive seconds). Returns the number, or
 * `null` when invalid (empty, zero, negative, non-integer).
 */
export function parseTimeoutSecs(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

/** The default request timeout (seconds) shown as the edit-panel placeholder —
 * mirrors `sf_core::invoker::DEFAULT_TIMEOUT_SECS`. */
export const DEFAULT_TIMEOUT_SECS = 120;

/** One preset badge/swatch color. `bg`/`fg` are ready-to-use CSS colors. */
export interface OrgColor {
  id: string;
  label: string;
  bg: string;
  fg: string;
}

/** Preset color palette for org badges (display-only). `id` is what we persist. */
export const ORG_COLORS: OrgColor[] = [
  { id: "slate", label: "Slate", bg: "#475569", fg: "#ffffff" },
  { id: "red", label: "Red", bg: "#dc2626", fg: "#ffffff" },
  { id: "amber", label: "Amber", bg: "#d97706", fg: "#ffffff" },
  { id: "green", label: "Green", bg: "#16a34a", fg: "#ffffff" },
  { id: "teal", label: "Teal", bg: "#0d9488", fg: "#ffffff" },
  { id: "blue", label: "Blue", bg: "#2563eb", fg: "#ffffff" },
  { id: "violet", label: "Violet", bg: "#7c3aed", fg: "#ffffff" },
  { id: "pink", label: "Pink", bg: "#db2777", fg: "#ffffff" },
];

/** Look up a preset color by id (undefined when unset / unknown). */
export function orgColor(id: string | undefined): OrgColor | undefined {
  return id ? ORG_COLORS.find((c) => c.id === id) : undefined;
}

/** An org's display name: configured alias > CLI alias > username. */
export function orgDisplayName(
  config: OrgConfig | undefined,
  org: OrgDto,
): string {
  return config?.alias ?? org.alias ?? org.username;
}

import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { getRoot, type Tool } from "./workspace";
import { joinPath } from "./paths";

type OldTab = { title: string; query?: string; src?: string };

const sanitize = (s: string) =>
  s.replace(/[/\\:*?"<>|]/g, "_").trim() || "untitled";

/** Pure: old tabs → unique <name>.<ext> filenames with content. */
export function planMigration(
  tool: Tool,
  oldTabs: OldTab[],
): { name: string; content: string }[] {
  const ext = tool;
  const seen = new Map<string, number>();
  return oldTabs.map((t) => {
    const base = sanitize(t.title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const name = `${base}${n > 1 ? ` (${n})` : ""}.${ext}`;
    return { name, content: tool === "soql" ? (t.query ?? "") : (t.src ?? "") };
  });
}

async function migrateTool(tool: Tool): Promise<void> {
  const old = await getJson<{ tabs?: OldTab[]; openPaths?: string[] } | null>(
    `tabs.${tool}`,
    null,
  );
  // Nothing to migrate, or already on the new { openPaths } shape.
  if (!old || old.openPaths || !Array.isArray(old.tabs) || old.tabs.length === 0)
    return;
  const root = await getRoot(tool);
  const plan = planMigration(tool, old.tabs);
  const openPaths: string[] = [];
  for (const { name, content } of plan) {
    const path = joinPath(root, name);
    await writeTextFile(path, content);
    openPaths.push(path);
  }
  await setJson(`tabs.${tool}`, { openPaths, activePath: openPaths[0] ?? null });
}

/** Runs once (guarded by a flag); writes old tab contents to script files. */
export async function runMigrationOnce(): Promise<void> {
  if (await getJson<boolean>("migrated.explorer", false)) return;
  try {
    await migrateTool("soql");
    await migrateTool("apex");
    await setJson("migrated.explorer", true);
  } catch {
    /* leave the flag unset so it retries next launch */
  }
}

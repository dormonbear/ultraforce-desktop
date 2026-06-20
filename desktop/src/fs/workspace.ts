import { appDataDir } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { joinPath } from "./paths";

export type Tool = "soql" | "apex";

const overrideKey = (tool: Tool) => `workspace.${tool}.path`;

/** Pure: override wins, else <appData>/workspace/<tool>. */
export function resolveRoot(
  tool: Tool,
  override: string | null,
  appData: string,
): string {
  return override ?? joinPath(appData, "workspace", tool);
}

export async function getRoot(tool: Tool): Promise<string> {
  const override = await getJson<string | null>(overrideKey(tool), null);
  const root = resolveRoot(tool, override, await appDataDir());
  if (!(await exists(root))) await mkdir(root, { recursive: true });
  return root;
}

export async function setRootOverride(
  tool: Tool,
  path: string | null,
): Promise<void> {
  await setJson(overrideKey(tool), path);
}

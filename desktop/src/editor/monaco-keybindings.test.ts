import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { WORD_NAV_BINDINGS } from "./monaco-keybindings";

/** Command ids registered by Monaco's wordOperations contrib, read straight from
 * the installed source. If we bind a keybinding to an id that isn't in this set,
 * `addKeybindingRules` silently no-ops — the exact bug class this guards. */
function registeredWordCommandIds(): Set<string> {
  const require = createRequire(import.meta.url);
  const wordOpsPath = require.resolve(
    "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js",
  );
  const src = readFileSync(wordOpsPath, "utf8");
  const ids = new Set<string>();
  for (const match of src.matchAll(/id:\s*'([^']+)'/g)) ids.add(match[1]);
  return ids;
}

describe("WORD_NAV_BINDINGS", () => {
  it("binds only command ids registered by Monaco's wordOperations contrib", () => {
    const registered = registeredWordCommandIds();
    // Sanity: the source parse actually found the word commands.
    expect(registered.has("cursorWordLeft")).toBe(true);
    for (const { command } of WORD_NAV_BINDINGS) {
      expect(registered, `unregistered command id: ${command}`).toContain(command);
    }
  });
});

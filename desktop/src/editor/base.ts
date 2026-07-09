import type { Monaco } from "@monaco-editor/react";
import { registerEditorThemes } from "../editor-themes";
import { configureWordNavKeybindings } from "./monaco-keybindings";

/** Shared editor setup for every Ultraforce language (SOQL, Apex): registers
 * the highlight themes both tokenizers' scopes resolve against, plus the
 * macOS word-navigation keybindings. Each language's `configure*` calls this
 * explicitly, so there is no hidden ordering dependency between them.
 * Idempotent. */
export function configureEditorBase(monaco: Monaco): void {
  registerEditorThemes(monaco);
  configureWordNavKeybindings(monaco);
}

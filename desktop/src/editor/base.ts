import type { Monaco } from "@monaco-editor/react";
import { registerEditorThemes } from "../editor-themes";

/** Shared editor setup for every Ultraforce language (SOQL, Apex): registers
 * the highlight themes both tokenizers' scopes resolve against. Each
 * language's `configure*` calls this explicitly, so there is no hidden
 * ordering dependency between them. Idempotent. */
export function configureEditorBase(monaco: Monaco): void {
  registerEditorThemes(monaco);
}

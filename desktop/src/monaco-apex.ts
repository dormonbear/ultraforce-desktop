import type { Monaco } from "@monaco-editor/react";
import { configureMonaco } from "./monaco-soql";

const APEX_KEYWORDS = [
  "System",
  "debug",
  "Integer",
  "String",
  "new",
  "for",
  "if",
  "return",
];

let registered = false;

/**
 * Ensure the shared `sf-dark` theme exists, then register a minimal `apex`
 * language with a handful of highlighted keywords. Reuses the SOQL token
 * scopes so the same theme colours apply.
 */
export function configureMonacoApex(monaco: Monaco): void {
  // Defines the `sf-dark` theme (idempotent re-register of theme + soql lang).
  configureMonaco(monaco);

  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "apex" });
  monaco.languages.setMonarchTokensProvider("apex", {
    keywords: APEX_KEYWORDS,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment.soql"],
        [/'[^']*'/, "string.soql"],
        [/\b\d+(\.\d+)?\b/, "number.soql"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword.soql",
              "@default": "identifier",
            },
          },
        ],
      ],
    },
  });
}

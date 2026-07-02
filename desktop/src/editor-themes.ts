import type { Monaco } from "@monaco-editor/react";

/** A highlight scheme = syntax colors for the 5 tokens Apex/SOQL emit.
 * The editor chrome (background, gutter, menus) stays constant per light/dark;
 * only the syntax palette changes. */
export type HighlightScheme = "sf" | "github" | "monokai" | "dracula";

export const HIGHLIGHT_SCHEMES: { id: HighlightScheme; label: string }[] = [
  { id: "sf", label: "Default" },
  { id: "github", label: "GitHub" },
  { id: "monokai", label: "Monokai" },
  { id: "dracula", label: "Dracula" },
];

type Palette = {
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
};

// [light, dark] syntax palette per scheme (hex without '#').
const PALETTES: Record<HighlightScheme, { light: Palette; dark: Palette }> = {
  sf: {
    light: { keyword: "8839ef", type: "179299", string: "40a02b", number: "fe640b", comment: "9ca0b0" },
    dark: { keyword: "c792ea", type: "56b6c2", string: "98c379", number: "d19a66", comment: "5b626d" },
  },
  github: {
    light: { keyword: "cf222e", type: "6f42c1", string: "0a3069", number: "0550ae", comment: "6e7781" },
    dark: { keyword: "ff7b72", type: "d2a8ff", string: "a5d6ff", number: "79c0ff", comment: "8b949e" },
  },
  monokai: {
    light: { keyword: "c2185b", type: "0288d1", string: "8d6e00", number: "6a1b9a", comment: "9e9e9e" },
    dark: { keyword: "f92672", type: "66d9ef", string: "e6db74", number: "ae81ff", comment: "75715e" },
  },
  dracula: {
    light: { keyword: "d6277a", type: "0b7285", string: "8b6f00", number: "7048e8", comment: "8a8fa3" },
    dark: { keyword: "ff79c6", type: "8be9fd", string: "f1fa8c", number: "bd93f9", comment: "6272a4" },
  },
};

// App chrome colors, shared across schemes (kept from the original sf themes).
const LIGHT_COLORS: Record<string, string> = {
  "editor.background": "#eff1f5",
  "editor.foreground": "#4c4f69",
  "editorGutter.background": "#e6e9ef",
  "editorLineNumber.foreground": "#9ca0b0",
  "editorLineNumber.activeForeground": "#4c4f69",
  "editor.selectionBackground": "#acb0be66",
  "editor.lineHighlightBackground": "#ccd0da66",
  "editorCursor.foreground": "#0176d3",
  "editorSuggestWidget.background": "#e6e9ef",
  "editorSuggestWidget.foreground": "#4c4f69",
  "editorSuggestWidget.border": "#ccd0da",
  "editorSuggestWidget.selectedBackground": "#ccd0da",
  "editorSuggestWidget.highlightForeground": "#1e66f5",
  "menu.background": "#ffffff",
  "menu.foreground": "#4c4f69",
  "menu.border": "#ccd0da",
  "menu.separatorBackground": "#e6e9ef",
  "menu.selectionBackground": "#e6e9ef",
  "menu.selectionForeground": "#4c4f69",
};

const DARK_COLORS: Record<string, string> = {
  "editor.background": "#16181d",
  "editor.foreground": "#e9eaee",
  "editorGutter.background": "#16181d",
  "editorLineNumber.foreground": "#4d5560",
  "editorLineNumber.activeForeground": "#aeb4be",
  "editor.selectionBackground": "#1b96ff33",
  "editor.lineHighlightBackground": "#ffffff08",
  "editorCursor.foreground": "#1b96ff",
  "editorSuggestWidget.background": "#1e2127",
  "editorSuggestWidget.foreground": "#e9eaee",
  "editorSuggestWidget.border": "#2a2e36",
  "editorSuggestWidget.selectedBackground": "#2b2f37",
  "editorSuggestWidget.highlightForeground": "#1b96ff",
  "menu.background": "#1e2127",
  "menu.foreground": "#e9eaee",
  "menu.border": "#2a2e36",
  "menu.separatorBackground": "#2a2e36",
  "menu.selectionBackground": "#2b2f37",
  "menu.selectionForeground": "#e9eaee",
};

function rules(p: Palette) {
  return [
    { token: "keyword.soql", foreground: p.keyword, fontStyle: "bold" },
    { token: "type.soql", foreground: p.type },
    { token: "string.soql", foreground: p.string },
    { token: "number.soql", foreground: p.number },
    { token: "comment.soql", foreground: p.comment, fontStyle: "italic" },
  ];
}

/** Monaco theme id for a scheme + app mode. Light: `<id>`, dark: `<id>-dark`. */
export function editorThemeId(scheme: HighlightScheme, dark: boolean): string {
  return dark ? `${scheme}-dark` : scheme;
}

export interface SchemeColors {
  bg: string;
  fg: string;
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
}

/** Resolved `#rrggbb` colors for a scheme + mode, for a static settings preview. */
export function schemeColors(scheme: HighlightScheme, dark: boolean): SchemeColors {
  const p = dark ? PALETTES[scheme].dark : PALETTES[scheme].light;
  const base = dark ? DARK_COLORS : LIGHT_COLORS;
  return {
    bg: base["editor.background"],
    fg: base["editor.foreground"],
    keyword: `#${p.keyword}`,
    type: `#${p.type}`,
    string: `#${p.string}`,
    number: `#${p.number}`,
    comment: `#${p.comment}`,
  };
}

/** Registers every scheme's light + dark Monaco theme. Idempotent. */
export function registerEditorThemes(monaco: Monaco): void {
  for (const { id } of HIGHLIGHT_SCHEMES) {
    const { light, dark } = PALETTES[id];
    monaco.editor.defineTheme(editorThemeId(id, false), {
      base: "vs",
      inherit: true,
      rules: rules(light),
      colors: LIGHT_COLORS,
    });
    monaco.editor.defineTheme(editorThemeId(id, true), {
      base: "vs-dark",
      inherit: true,
      rules: rules(dark),
      colors: DARK_COLORS,
    });
  }
}

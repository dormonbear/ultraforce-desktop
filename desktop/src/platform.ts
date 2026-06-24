/** macOS detection for Cmd-vs-Ctrl shortcut display in the desktop webview. */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

/** Human-readable run shortcut: "⌘↵" on macOS, else "Ctrl+↵". */
export const runShortcut = (): string => (isMac() ? "⌘↵" : "Ctrl+↵");

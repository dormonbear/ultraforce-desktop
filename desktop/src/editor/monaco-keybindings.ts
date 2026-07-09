import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";

/** macOS is the only platform we rebind: the physical Ctrl key (`WinCtrl`) is
 * free there for word navigation while Cmd (`CtrlCmd`) keeps line start/end.
 * On Windows/Linux Ctrl+Arrow already moves by word, so we leave it alone. */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

let disposable: IDisposable | undefined;

/** The word-nav bindings we install on macOS. `command` must be a command id
 * registered by Monaco's wordOperations contrib (`cursorWordLeft` moves to the
 * previous word start, `cursorWordRight` to the next word end — the standard
 * UX); a typo'd id would silently no-op. `arrow`/`select` drive the keybinding.
 * Exported so a unit test can assert every id is a real registered command,
 * catching invalid-id regressions in CI. */
export const WORD_NAV_BINDINGS = [
  { command: "cursorWordLeft", arrow: "LeftArrow", select: false },
  { command: "cursorWordRight", arrow: "RightArrow", select: false },
  { command: "cursorWordLeftSelect", arrow: "LeftArrow", select: true },
  { command: "cursorWordRightSelect", arrow: "RightArrow", select: true },
] as const;

/** On macOS, bind physical Ctrl+Left/Right to word-wise cursor movement (and
 * Ctrl+Shift+Left/Right to the selecting variants), matching the Windows habit.
 * Cmd+Arrow keeps line start/end because `CtrlCmd` is Cmd on mac and is left
 * untouched.
 *
 * `addKeybindingRules` registers globally, so we dispose any prior registration
 * before re-adding — idempotent and HMR-safe without a module-level boolean. */
export function configureWordNavKeybindings(monaco: Monaco): void {
  if (!isMac()) return;
  disposable?.dispose();
  const { WinCtrl, Shift } = monaco.KeyMod;
  disposable = monaco.editor.addKeybindingRules(
    WORD_NAV_BINDINGS.map(({ command, arrow, select }) => ({
      keybinding: WinCtrl | (select ? Shift : 0) | monaco.KeyCode[arrow],
      command,
    })),
  );
}

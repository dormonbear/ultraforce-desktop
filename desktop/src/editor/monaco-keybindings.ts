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
  const { LeftArrow, RightArrow } = monaco.KeyCode;
  disposable = monaco.editor.addKeybindingRules([
    { keybinding: WinCtrl | LeftArrow, command: "cursorWordLeft" },
    { keybinding: WinCtrl | RightArrow, command: "cursorWordRight" },
    { keybinding: WinCtrl | Shift | LeftArrow, command: "cursorWordLeftSelect" },
    { keybinding: WinCtrl | Shift | RightArrow, command: "cursorWordRightSelect" },
  ]);
}

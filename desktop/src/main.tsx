import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ThemeProvider } from "./theme";
import { AstryxThemeProvider } from "./AstryxThemeProvider";
import { OrgProvider } from "./org";
import { ConfirmProvider } from "./components/confirm";
import { hideToTray } from "./ipc/window";
import { runMigrationOnce } from "./fs/migrate";
import { markStartup } from "./startup";
import { flush } from "./store";
import "./styles.css";
// Loaded after styles.css so the motion layer keeps its original (bottom-of-
// styles.css) cascade position — see motion.css header.
import "./motion.css";

// Closing parks the app in the menu bar rather than quitting, so the next open
// is warm (Quit lives in the tray menu). Either way, flush first: debounced
// writes from the last DEBOUNCE_MS would otherwise be lost.
// ponytail: ⌘Q goes straight to macOS terminate without a close-requested event,
// so it can still drop the last ~400ms of edits. Add a Rust-side ExitRequested
// handshake if that ever bites.
// getCurrentWindow() throws synchronously outside Tauri (plain-browser dev),
// hence try/catch rather than .catch().
try {
  const win = getCurrentWindow();
  void win.onCloseRequested(async (e) => {
    e.preventDefault();
    await flush();
    // No tray to come back through → close for real instead of stranding the app.
    if (!(await hideToTray())) await win.destroy();
  });
} catch {
  // Not running under Tauri — no window to flush on close.
}

// Suppress the native WebView context menu (Look Up / Translate / Inspect …)
// everywhere except Monaco's own editor menu and real text inputs, where a
// context menu is genuinely useful.
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest(".monaco-editor, input, textarea")) return;
  e.preventDefault();
});

// Migrate any pre-explorer persisted tabs into script files before first paint.
void runMigrationOnce().finally(() => {
  markStartup("render");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <AstryxThemeProvider>
          <OrgProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </OrgProvider>
        </AstryxThemeProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
});

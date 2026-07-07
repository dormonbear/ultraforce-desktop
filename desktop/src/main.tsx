import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ThemeProvider } from "./theme";
import { OrgProvider } from "./org";
import { ConfirmProvider } from "./components/confirm";
import { runMigrationOnce } from "./fs/migrate";
import { flush } from "./store";
import "./styles.css";

// Persist any debounced writes before the window closes, otherwise the last
// few edits (within DEBOUNCE_MS of quitting) are lost. onCloseRequested awaits
// the handler and then closes the window itself — no preventDefault needed.
// getCurrentWindow() throws synchronously outside Tauri (plain-browser dev),
// hence try/catch rather than .catch().
try {
  void getCurrentWindow().onCloseRequested(async () => {
    await flush();
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
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <OrgProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </OrgProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
});

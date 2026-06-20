import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme";
import { OrgProvider } from "./org";
import { runMigrationOnce } from "./fs/migrate";
import "./styles.css";

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
          <App />
        </OrgProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
});

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  editorThemeId,
  HIGHLIGHT_SCHEMES,
  type HighlightScheme,
} from "./editor-themes";

export type Theme = "light" | "dark";

const KEY = "sf-toolkit-theme";
const SCHEME_KEY = "sf-toolkit-highlight";

function initialTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "dark" || stored === "light") return stored;
  // No saved preference yet → honor the OS color scheme on first launch.
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function initialScheme(): HighlightScheme {
  const stored = localStorage.getItem(SCHEME_KEY);
  return HIGHLIGHT_SCHEMES.some((s) => s.id === stored)
    ? (stored as HighlightScheme)
    : "sf";
}

const ThemeCtx = createContext<{
  theme: Theme;
  toggle: () => void;
  scheme: HighlightScheme;
  setScheme: (s: HighlightScheme) => void;
}>({
  theme: "light",
  toggle: () => {},
  scheme: "sf",
  setScheme: () => {},
});

/** Owns the app theme + editor highlight scheme; mirrors theme onto the
 * `<html>` `.dark` class and persists both to localStorage. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [scheme, setSchemeState] = useState<HighlightScheme>(initialScheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const setScheme = (s: HighlightScheme) => {
    setSchemeState(s);
    localStorage.setItem(SCHEME_KEY, s);
  };

  return (
    <ThemeCtx.Provider value={{ theme, toggle, scheme, setScheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);

/** Monaco editor theme id for the current app theme + highlight scheme. */
export const monacoTheme = (t: Theme, scheme: HighlightScheme = "sf"): string =>
  editorThemeId(scheme, t === "dark");

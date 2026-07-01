import { useEffect, useState } from "react";
import {
  Database,
  Terminal,
  ScrollText,
  Table as TableIcon,
  Settings,
} from "lucide-react";
import { SoqlTabs } from "./panels/SoqlTabs";
import { ApexTabs } from "./panels/ApexTabs";
import { LogsPanel } from "./panels/LogsPanel";
import { OrgSelector } from "./components/OrgSelector";
import { SetupPage } from "./components/SetupPage";
import { LogoLoader } from "./components/LogoLoader";
import { useOrgs } from "./org";
import { isMac } from "./platform";
import { IndexProgress, TopProgressBar } from "./components/IndexProgress";
import { SyncToast } from "./components/SyncToast";
import { SchemaRefresh } from "./components/SchemaRefresh";
import { SettingsPage } from "./components/SettingsPage";
import { checkForUpdates } from "./updater";
import { useTheme } from "./theme";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ActivePanel = "soql" | "apex" | "logs" | "settings";

const RAIL = [
  { id: "soql", icon: Database, label: "SOQL", enabled: true },
  { id: "apex", icon: Terminal, label: "Apex", enabled: true },
  { id: "logs", icon: ScrollText, label: "Logs", enabled: true },
  { id: "schema", icon: TableIcon, label: "Schema", enabled: false },
] as const;

export default function App() {
  const [active, setActive] = useState<ActivePanel>("soql");
  // Tools mount on first visit and stay mounted (hidden when inactive) so run
  // results survive a tool switch. Logs is lazy too: no network call until opened.
  const [visited, setVisited] = useState<ActivePanel[]>([active]);
  // Bumped when a workspace root changes, to remount the affected tool panel.
  const [wsVersion, setWsVersion] = useState(0);
  const { theme } = useTheme();
  const { loading: orgLoading, orgs } = useOrgs();
  // No usable org (CLI missing / not authed) → guide the user instead of panels.
  const needsSetup = !orgLoading && orgs.length === 0;

  useEffect(() => {
    // fallow-ignore-next-line complexity
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === ",") {
        e.preventDefault();
        setActive("settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setVisited((v) => (v.includes(active) ? v : [...v, active]));
  }, [active]);

  // Cmd/Ctrl+1..3 switches tools (1=SOQL, 2=Apex, 3=Logs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > RAIL.length) return;
      const item = RAIL[n - 1];
      if (!item.enabled) return;
      e.preventDefault();
      setActive(item.id as ActivePanel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Check GitHub Releases for a newer version once on startup.
  useEffect(() => {
    void checkForUpdates();
  }, []);

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top bar — doubles as the window drag region (native title bar hidden) */}
      <header
        data-tauri-drag-region
        className={`flex h-12 shrink-0 items-center justify-between border-b border-border pr-4 ${
          isMac() ? "pl-24" : "pl-4"
        }`}
      >
        <div className="pointer-events-none flex select-none items-center gap-2">
          <svg
            viewBox="0 0 128 128"
            className="size-[22px] text-primary"
            role="img"
            aria-label="Ultraforce"
          >
            <g fill="currentColor">
              <path d="M16 30H31L89 64L31 98H16L74 64Z" />
              <path d="M48 30H63L121 64L63 98H48L106 64Z" />
            </g>
          </svg>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Ultraforce
          </span>
        </div>
        <div className="flex items-center gap-2">
          <IndexProgress />
          <SchemaRefresh />
          <OrgSelector />
        </div>
      </header>

      {/* 2px accent strip under the title bar — doubles as the org-indexing progress bar */}
      <TopProgressBar />

      <div className="flex min-h-0 flex-1">
        {/* Activity rail */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {RAIL.map(({ id, icon: Icon, label, enabled }, index) => {
            const current = enabled && id === active;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-disabled={!enabled}
                    aria-label={label}
                    aria-current={current ? "page" : undefined}
                    onClick={() => enabled && setActive(id as ActivePanel)}
                    className={`focus-accent relative flex h-9 w-9 items-center justify-center rounded-md ${
                      current
                        ? "text-primary"
                        : enabled
                          ? "text-text-dim hover:text-foreground"
                          : "text-muted-foreground"
                    } ${enabled ? "cursor-pointer" : "cursor-not-allowed"}`}
                  >
                    {current && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-primary" />
                    )}
                    <Icon size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {label}
                  {enabled ? (
                    <span className="ml-2 text-muted-foreground">
                      {isMac() ? "⌘" : "Ctrl+"}
                      {index + 1}
                    </span>
                  ) : (
                    <span className="ml-2 text-muted-foreground">Coming soon</span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                aria-current={active === "settings" ? "page" : undefined}
                onClick={() => setActive("settings")}
                className={`focus-accent relative mt-auto mb-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md ${
                  active === "settings"
                    ? "text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                {active === "settings" && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-primary" />
                )}
                <Settings size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Settings
              <span className="ml-2 text-muted-foreground">
                {isMac() ? "⌘," : "Ctrl+,"}
              </span>
            </TooltipContent>
          </Tooltip>
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {orgLoading ? (
            <div className="flex h-full items-center justify-center">
              <LogoLoader size={120} />
            </div>
          ) : needsSetup ? (
            active === "settings" ? (
              <SettingsPage onChanged={() => setWsVersion((v) => v + 1)} />
            ) : (
              <SetupPage />
            )
          ) : (
            <>
              {visited.includes("soql") && (
                <div className="h-full" hidden={active !== "soql"}>
                  <SoqlTabs key={`soql-${wsVersion}`} />
                </div>
              )}
              {visited.includes("apex") && (
                <div className="h-full" hidden={active !== "apex"}>
                  <ApexTabs key={`apex-${wsVersion}`} />
                </div>
              )}
              {visited.includes("logs") && (
                <div className="h-full" hidden={active !== "logs"}>
                  <LogsPanel />
                </div>
              )}
              {active === "settings" && (
                <SettingsPage onChanged={() => setWsVersion((v) => v + 1)} />
              )}
            </>
          )}
        </main>
      </div>
      <SyncToast />
      <Toaster theme={theme} />
    </div>
    </TooltipProvider>
  );
}

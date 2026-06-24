import { useEffect, useState } from "react";
import {
  Database,
  Terminal,
  ScrollText,
  Table as TableIcon,
  Sun,
  Moon,
  History as HistoryIcon,
  Command as CommandIcon,
} from "lucide-react";
import { SoqlTabs } from "./panels/SoqlTabs";
import { ApexTabs } from "./panels/ApexTabs";
import { LogsPanel } from "./panels/LogsPanel";
import { OrgSelector } from "./components/OrgSelector";
import { SetupPage } from "./components/SetupPage";
import { useOrgs } from "./org";
import { isMac } from "./platform";
import { CommandPalette } from "./components/CommandPalette";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { IndexProgress, TopProgressBar } from "./components/IndexProgress";
import { SyncToast } from "./components/SyncToast";
import { SchemaRefresh } from "./components/SchemaRefresh";
import { WorkspaceSettings } from "./components/WorkspaceSettings";
import { onOpenTabRequest } from "./openTab";
import { checkForUpdates } from "./updater";
import { useTheme } from "./theme";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ActivePanel = "soql" | "apex" | "logs";

const RAIL = [
  { id: "soql", icon: Database, label: "SOQL", enabled: true },
  { id: "apex", icon: Terminal, label: "Apex", enabled: true },
  { id: "logs", icon: ScrollText, label: "Logs", enabled: true },
  { id: "schema", icon: TableIcon, label: "Schema", enabled: false },
] as const;

export default function App() {
  const [active, setActive] = useState<ActivePanel>("soql");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  // Bumped when a workspace root changes, to remount the affected tool panel.
  const [wsVersion, setWsVersion] = useState(0);
  const { theme, toggle } = useTheme();
  const themeTitle = theme === "dark" ? "Switch to light" : "Switch to dark";
  const { loading: orgLoading, orgs } = useOrgs();
  // No usable org (CLI missing / not authed) → guide the user instead of panels.
  const needsSetup = !orgLoading && orgs.length === 0;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // History "open in tab" requests switch to the owning tool's panel.
  useEffect(() => onOpenTabRequest((tool) => setActive(tool)), []);

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
      {/* 2px accent strip — doubles as the org-indexing progress bar */}
      <TopProgressBar />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <svg
          viewBox="0 0 128 128"
          className="size-[22px] select-none"
          role="img"
          aria-label="Ultraforce"
        >
          <g fill="#E0532F">
            <path d="M16 30H31L89 64L31 98H16L74 64Z" />
            <path d="M48 30H63L121 64L63 98H48L106 64Z" />
          </g>
        </svg>
        <div className="flex items-center gap-2">
          <IndexProgress />
          <SchemaRefresh />
          <WorkspaceSettings onChanged={() => setWsVersion((v) => v + 1)} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCmdOpen(true)}
                aria-label="Command palette"
                className="size-7 cursor-pointer text-text-dim hover:text-foreground"
              >
                <CommandIcon size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Command palette
              <span className="ml-2 text-muted-foreground">
                {isMac() ? "⌘K" : "Ctrl+K"}
              </span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHistOpen(true)}
                aria-label="Run history"
                className="size-7 cursor-pointer text-text-dim hover:text-foreground"
              >
                <HistoryIcon size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Toggle color theme"
                className="size-7 cursor-pointer text-text-dim hover:text-foreground"
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{themeTitle}</TooltipContent>
          </Tooltip>
          <OrgSelector />
        </div>
      </header>

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
                    disabled={!enabled}
                    aria-label={label}
                    aria-current={current ? "page" : undefined}
                    onClick={() => enabled && setActive(id as ActivePanel)}
                    className={`focus-accent relative flex h-9 w-9 items-center justify-center rounded-md ${
                      current
                        ? "text-primary"
                        : enabled
                          ? "text-text-dim hover:text-foreground"
                          : "text-muted-foreground disabled:cursor-not-allowed"
                    } cursor-pointer`}
                  >
                    {current && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-primary" />
                    )}
                    <Icon size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {label}
                  {enabled && (
                    <span className="ml-2 text-muted-foreground">
                      {isMac() ? "⌘" : "Ctrl+"}
                      {index + 1}
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {needsSetup ? (
            <SetupPage />
          ) : (
            <>
              {active === "soql" && <SoqlTabs key={`soql-${wsVersion}`} />}
              {active === "apex" && <ApexTabs key={`apex-${wsVersion}`} />}
              {active === "logs" && <LogsPanel />}
            </>
          )}
        </main>
      </div>
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onSelectPanel={setActive}
        onOpenHistory={() => setHistOpen(true)}
      />
      <HistoryDrawer open={histOpen} onOpenChange={setHistOpen} />
      <SyncToast />
      <Toaster theme={theme} />
    </div>
    </TooltipProvider>
  );
}

import { useEffect, useState } from "react";
import {
  Database,
  Terminal,
  ScrollText,
  Table as TableIcon,
  Sun,
  Moon,
  History as HistoryIcon,
} from "lucide-react";
import { SoqlTabs } from "./panels/SoqlTabs";
import { ApexTabs } from "./panels/ApexTabs";
import { LogsPanel } from "./panels/LogsPanel";
import { OrgSelector } from "./components/OrgSelector";
import { CommandPalette } from "./components/CommandPalette";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { IndexProgress, TopProgressBar } from "./components/IndexProgress";
import { SyncToast } from "./components/SyncToast";
import { SchemaRefresh } from "./components/SchemaRefresh";
import { WorkspaceSettings } from "./components/WorkspaceSettings";
import { onOpenTabRequest } from "./openTab";
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

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 2px accent strip — doubles as the org-indexing progress bar */}
      <TopProgressBar />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span
          className="text-[20px] font-normal tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ULTRAFORCE
        </span>
        <div className="flex items-center gap-2">
          <IndexProgress />
          <SchemaRefresh />
          <WorkspaceSettings onChanged={() => setWsVersion((v) => v + 1)} />
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
          {RAIL.map(({ id, icon: Icon, label, enabled }) => {
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
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {active === "soql" && <SoqlTabs key={`soql-${wsVersion}`} />}
          {active === "apex" && <ApexTabs key={`apex-${wsVersion}`} />}
          {active === "logs" && <LogsPanel />}
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

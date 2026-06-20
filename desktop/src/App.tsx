import { useEffect, useState } from "react";
import {
  Database,
  Terminal,
  ScrollText,
  Table as TableIcon,
  Sun,
  Moon,
} from "lucide-react";
import { SoqlTabs } from "./panels/SoqlTabs";
import { ApexTabs } from "./panels/ApexTabs";
import { LogsPanel } from "./panels/LogsPanel";
import { OrgSelector } from "./components/OrgSelector";
import { CommandPalette } from "./components/CommandPalette";
import { useTheme } from "./theme";
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

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col bg-bg text-text">
      {/* 2px accent strip */}
      <div className="h-0.5 w-full bg-primary" />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hair px-4">
        <span
          className="text-[20px] font-normal tracking-tight text-text"
          style={{ fontFamily: "var(--font-display)" }}
        >
          SF·TOOLKIT
        </span>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label="Toggle color theme"
                className="focus-accent flex h-7 w-7 cursor-pointer items-center justify-center rounded-[3px] text-text-dim transition-colors hover:text-text"
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{themeTitle}</TooltipContent>
          </Tooltip>
          <OrgSelector />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity rail */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-hair py-2">
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
                    className={`focus-accent relative flex h-9 w-9 items-center justify-center rounded-[3px] ${
                      current
                        ? "text-primary"
                        : enabled
                          ? "text-text-dim hover:text-text"
                          : "text-text-faint disabled:cursor-not-allowed"
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
          {active === "soql" && <SoqlTabs />}
          {active === "apex" && <ApexTabs />}
          {active === "logs" && <LogsPanel />}
        </main>
      </div>
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onSelectPanel={setActive}
      />
      <Toaster theme={theme} />
    </div>
    </TooltipProvider>
  );
}

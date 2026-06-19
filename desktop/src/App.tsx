import { useState } from "react";
import { Database, Terminal, ScrollText, Table as TableIcon } from "lucide-react";
import { SoqlPanel } from "./panels/SoqlPanel";
import { ApexPanel } from "./panels/ApexPanel";
import { LogsPanel } from "./panels/LogsPanel";

type ActivePanel = "soql" | "apex" | "logs";

const RAIL = [
  { id: "soql", icon: Database, label: "SOQL", enabled: true },
  { id: "apex", icon: Terminal, label: "Apex", enabled: true },
  { id: "logs", icon: ScrollText, label: "Logs", enabled: true },
  { id: "schema", icon: TableIcon, label: "Schema", enabled: false },
] as const;

export default function App() {
  const [active, setActive] = useState<ActivePanel>("soql");

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* 2px accent strip */}
      <div className="h-0.5 w-full bg-accent" />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hair px-4">
        <span
          className="text-[20px] font-bold tracking-wide text-text"
          style={{ fontFamily: "var(--font-display)" }}
        >
          SF·TOOLKIT
        </span>
        <span className="inline-flex items-center gap-2 rounded-[3px] border border-hair px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          ORG default
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity rail */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-hair py-2">
          {RAIL.map(({ id, icon: Icon, label, enabled }) => {
            const current = enabled && id === active;
            return (
              <button
                key={id}
                type="button"
                title={label}
                disabled={!enabled}
                aria-current={current ? "page" : undefined}
                onClick={() => enabled && setActive(id as ActivePanel)}
                className={`focus-accent relative flex h-9 w-9 items-center justify-center rounded-[3px] ${
                  current
                    ? "text-accent"
                    : enabled
                      ? "text-text-dim hover:text-text"
                      : "text-text-faint disabled:cursor-not-allowed"
                } cursor-pointer`}
              >
                {current && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-accent" />
                )}
                <Icon size={18} />
              </button>
            );
          })}
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {active === "soql" && <SoqlPanel />}
          {active === "apex" && <ApexPanel />}
          {active === "logs" && <LogsPanel />}
        </main>
      </div>
    </div>
  );
}

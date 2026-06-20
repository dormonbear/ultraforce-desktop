import { Plus, X } from "lucide-react";
import type { TabBase } from "./types";

interface TabStripProps {
  tabs: TabBase[];
  activeId: string;
  ariaLabel: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

/** Presentational tablist mirroring the activity-rail accent treatment. */
export function TabStrip({
  tabs,
  activeId,
  ariaLabel,
  onSelect,
  onClose,
  onAdd,
}: TabStripProps) {
  const lone = tabs.length === 1;

  const onKeyDown = (e: React.KeyboardEvent, id: string, idx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      onSelect(next.id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onClose(id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex h-9 shrink-0 items-center gap-px border-b border-border bg-card px-2"
    >
      {tabs.map((t, idx) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, t.id, idx)}
            className={`focus-accent group relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-[12px] transition-colors ${
              active ? "text-primary" : "text-text-dim hover:text-foreground"
            }`}
          >
            {active && (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-primary" />
            )}
            <span className="tnum whitespace-nowrap">{t.title}</span>
            <button
              type="button"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className={`cursor-pointer rounded-[2px] text-muted-foreground transition-colors hover:text-destructive ${
                lone ? "invisible" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              } ${active ? "opacity-100" : ""}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        onClick={onAdd}
        className="focus-accent ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-dim transition-colors hover:text-primary"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

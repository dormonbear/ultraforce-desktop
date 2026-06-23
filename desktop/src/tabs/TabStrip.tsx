import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { TabBase } from "./types";

interface TabStripProps {
  tabs: TabBase[];
  activeId: string;
  ariaLabel: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /** Commit a new title for a tab (double-click to start editing). */
  onRename?: (id: string, title: string) => void;
  /** Ids of tabs with unsaved content (shown with a dot). */
  dirtyIds?: string[];
}

/** Presentational tablist mirroring the activity-rail accent treatment. */
export function TabStrip({
  tabs,
  activeId,
  ariaLabel,
  onSelect,
  onClose,
  onAdd,
  onRename,
  dirtyIds,
}: TabStripProps) {
  const lone = tabs.length === 1;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = (t: TabBase) => {
    if (!onRename) return;
    setDraft(t.title);
    setEditing(t.id);
  };
  const commit = () => {
    if (editing && onRename) onRename(editing, draft);
    setEditing(null);
  };

  const onKeyDown = (e: React.KeyboardEvent, id: string, idx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      onSelect(next.id);
      // Move DOM focus with the roving tabindex so keyboard nav lands correctly.
      document.getElementById(`tab-${next.id}`)?.focus();
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
            title={t.path || undefined}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => {
              // Middle-click closes the tab (unless it's the last one).
              if (e.button === 1 && !lone) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            onKeyDown={(e) => onKeyDown(e, t.id, idx)}
            className={`focus-accent group relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-[12px] transition-colors ${
              active ? "text-primary" : "text-text-dim hover:text-foreground"
            }`}
          >
            {active && (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-primary" />
            )}
            {editing === t.id ? (
              <input
                ref={inputRef}
                value={draft}
                aria-label={`Rename ${t.title}`}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") setEditing(null);
                }}
                className="tnum w-28 rounded-[2px] bg-transparent text-[12px] text-foreground outline-none ring-1 ring-primary/60"
              />
            ) : (
              <span
                className="tnum flex items-center gap-1.5 whitespace-nowrap"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit(t);
                }}
              >
                {dirtyIds?.includes(t.id) && (
                  <span
                    data-testid="unsaved-dot"
                    title="Unsaved changes"
                    className="size-1.5 shrink-0 rounded-full bg-current"
                  />
                )}
                {t.title}
              </span>
            )}
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

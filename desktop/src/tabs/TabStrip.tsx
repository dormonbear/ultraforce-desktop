import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { stemSelectionEnd } from "./nameEdit";
import type { TabBase } from "./types";

interface TabStripProps {
  tabs: TabBase[];
  activeId: string;
  ariaLabel: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /**
   * Commit a new name for a tab (double-click or context menu to start).
   * Return `true` to close the editor, `false` to keep it open (e.g. the
   * rename failed validation) so the user can correct the name.
   */
  onRename?: (id: string, title: string) => boolean | Promise<boolean>;
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
  // True while the editor is mounting/focusing. The context menu closing hands
  // focus around, which fires a spurious blur; ignore it so the editor stays open.
  const opening = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    el.focus();
    // Preselect the name part, keeping the extension so overtyping preserves it.
    el.setSelectionRange(0, stemSelectionEnd(el.value));
    const raf = requestAnimationFrame(() => {
      opening.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // Keep the active tab visible when the strip overflows horizontally.
  useEffect(() => {
    document
      .getElementById(`tab-${activeId}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const startEdit = (t: TabBase) => {
    if (!onRename) return;
    opening.current = true;
    setDraft(t.title);
    setEditing(t.id);
  };
  const commit = async () => {
    if (!editing || !onRename) {
      setEditing(null);
      return;
    }
    const ok = await onRename(editing, draft);
    if (ok) setEditing(null);
    else inputRef.current?.select(); // keep editing; reselect for a retry
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
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-card px-2">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-px overflow-x-auto"
      >
      {tabs.map((t, idx) => {
        const active = t.id === activeId;
        return (
          <ContextMenu key={t.id}>
          <ContextMenuTrigger asChild>
          <div
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => {
              // Middle-click closes the tab (unless it's the last one).
              if (e.button === 1 && !lone) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            onKeyDown={(e) => onKeyDown(e, t.id, idx)}
            className={`focus-accent group relative flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-[12px] transition-colors ${
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
                onBlur={() => {
                  if (!opening.current) void commit();
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") setEditing(null);
                }}
                className="tnum w-28 rounded bg-transparent text-[12px] text-foreground outline-none ring-1 ring-primary/60"
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
                    aria-label="Unsaved changes"
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
              className={`cursor-pointer rounded text-muted-foreground transition-colors hover:text-destructive ${
                lone ? "invisible" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              } ${active ? "opacity-100" : ""}`}
            >
              <X size={12} />
            </button>
          </div>
          </ContextMenuTrigger>
          {/* Don't restore focus to the tab on close: the freshly mounted
              rename input must keep its autofocus. */}
          <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
            {onRename && (
              <>
                <ContextMenuItem onSelect={() => startEdit(t)}>
                  Rename
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onSelect={() => onClose(t.id)}>Close</ContextMenuItem>
            <ContextMenuItem
              disabled={tabs.length === 1}
              onSelect={() =>
                tabs.filter((x) => x.id !== t.id).forEach((x) => onClose(x.id))
              }
            >
              Close Others
            </ContextMenuItem>
            <ContextMenuItem
              disabled={idx === tabs.length - 1}
              onSelect={() => tabs.slice(idx + 1).forEach((x) => onClose(x.id))}
            >
              Close Tabs to the Right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => tabs.forEach((x) => onClose(x.id))}>
              Close All
            </ContextMenuItem>
          </ContextMenuContent>
          </ContextMenu>
        );
      })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        onClick={onAdd}
        className="focus-accent ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-dim transition-colors hover:text-primary"
      >
        <Plus size={14} />
      </button>
      {tabs.length > 1 && (
        <DropdownMenu
          menuWidth={224}
          hasChevron={false}
          className="max-h-72 overflow-auto"
          button={{
            label: "All tabs",
            "aria-label": "All tabs",
            tooltip: "All tabs",
            variant: "ghost",
            size: "sm",
            isIconOnly: true,
            icon: <ChevronDown size={14} />,
            className:
              "h-7 w-6 shrink-0 text-text-dim hover:text-foreground",
          }}
        >
          {tabs.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={t.id === activeId ? "text-primary" : undefined}
              label={
                <span className="flex items-center gap-1.5">
                  {dirtyIds?.includes(t.id) && (
                    <span className="size-1.5 shrink-0 rounded-full bg-current" />
                  )}
                  <span className="truncate">{t.title}</span>
                </span>
              }
            />
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}

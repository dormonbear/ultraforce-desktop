import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FilePlus, FolderPlus, RefreshCw, Search, X } from "lucide-react";
import {
  readTree,
  createFile,
  createDir,
  renameNode,
  removeNode,
  moveNode,
  type TreeNode as Node,
} from "../fs/tree";
import { filterTree, searchContent, type FileHit } from "../fs/search";
import { dirname } from "../fs/paths";
import { TreeNode } from "./TreeNode";

interface Props {
  root: string;
  ext: "soql" | "apex";
  activePath: string | null;
  onOpen: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (path: string) => void;
}

type Edit =
  | { kind: "rename"; path: string }
  | { kind: "new-file" | "new-dir"; dir: string };

/** File-explorer sidebar for one tool's workspace root. */
export function Explorer({
  root,
  ext,
  activePath,
  onOpen,
  onRenamed,
  onRemoved,
}: Props) {
  const [tree, setTree] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"name" | "content">("name");
  const [hits, setHits] = useState<FileHit[] | null>(null);

  const refresh = useCallback(() => {
    void readTree(root).then(setTree);
  }, [root]);
  useEffect(refresh, [refresh]);
  // Re-read when the window regains focus (cheap external-change pickup).
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const commitName = async (name: string) => {
    const e = edit;
    setEdit(null);
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    if (e.kind === "rename") {
      const to = await renameNode(e.path, trimmed);
      onRenamed(e.path, to);
    } else if (e.kind === "new-file") {
      await createFile(e.dir, ensureExt(trimmed, ext));
    } else {
      await createDir(e.dir, trimmed);
    }
    refresh();
  };

  const del = async (node: Node) => {
    await removeNode(node.path, node.kind === "dir");
    onRemoved(node.path);
    refresh();
  };

  const onContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    // Minimal menu without a popover dep: right-click = rename,
    // Shift+right-click = delete.
    if (e.shiftKey) void del(node);
    else setEdit({ kind: "rename", path: node.path });
  };

  const newAt = (kind: "new-file" | "new-dir") => {
    const dir = activePath ? dirname(activePath) : root;
    setEdit({ kind, dir });
  };

  const drop = async (intoDir: string) => {
    if (!drag) return;
    const from = drag;
    setDrag(null);
    if (dirname(from) === intoDir) return; // already there
    const to = await moveNode(from, intoDir);
    onRenamed(from, to);
    refresh();
  };

  // Name-filter the tree live; when active, dirs auto-expand to reveal hits.
  const nameFilter = mode === "name" ? query.trim() : "";
  const shown = nameFilter ? filterTree(tree, nameFilter) : tree;
  const forceExpand = nameFilter.length > 0;

  const runContentSearch = () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    void searchContent(tree, q).then(setHits);
  };

  const rows: ReactElement[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      const isOpen = forceExpand || expanded.has(n.path);
      rows.push(
        <TreeNode
          key={n.path}
          node={n}
          depth={depth}
          expanded={isOpen}
          active={n.path === activePath}
          editing={edit?.kind === "rename" && edit.path === n.path}
          onToggle={() => toggle(n.path)}
          onOpen={() => onOpen(n.path)}
          onContextMenu={(e) => onContextMenu(e, n)}
          onCommitName={commitName}
          onCancelEdit={() => setEdit(null)}
          onDragStartNode={() => setDrag(n.path)}
          onDropOnDir={() => void drop(n.path)}
        />,
      );
      if (n.kind === "dir" && isOpen && n.children) walk(n.children, depth + 1);
    }
  };
  walk(shown, 0);

  return (
    <div
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-background"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void drop(root);
      }}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Search size={12} className="shrink-0 text-text-dim" />
        <input
          value={query}
          placeholder={mode === "name" ? "Filter by name" : "Search in files"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (mode === "content" && e.key === "Enter") runContentSearch();
            else if (e.key === "Escape") {
              setQuery("");
              setHits(null);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-dim"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setHits(null);
            }}
            className="shrink-0 text-text-dim hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
        <button
          type="button"
          aria-label="Toggle search mode"
          title={mode === "name" ? "Filter file names" : "Search file contents"}
          onClick={() => {
            setMode((m) => (m === "name" ? "content" : "name"));
            setHits(null);
          }}
          className={`shrink-0 rounded px-1 text-[10px] font-medium uppercase ${
            mode === "content"
              ? "bg-primary/15 text-primary"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          {mode === "name" ? "Aa" : "Txt"}
        </button>
      </div>
      <div className="flex h-9 items-center justify-end gap-1 border-b border-border px-2">
        <IconBtn label="New file" onClick={() => newAt("new-file")}>
          <FilePlus size={14} />
        </IconBtn>
        <IconBtn label="New folder" onClick={() => newAt("new-dir")}>
          <FolderPlus size={14} />
        </IconBtn>
        <IconBtn label="Refresh" onClick={refresh}>
          <RefreshCw size={13} />
        </IconBtn>
      </div>
      {mode === "content" && hits !== null ? (
        <div className="min-h-0 flex-1 overflow-auto py-1 text-[12px]">
          {hits.length === 0 ? (
            <div className="px-3 py-2 text-text-dim">No matches</div>
          ) : (
            hits.map((h) => (
              <div key={h.path} className="mb-1">
                <button
                  type="button"
                  onClick={() => onOpen(h.path)}
                  className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-text-dim hover:text-foreground"
                >
                  <span className="truncate font-medium">{h.name}</span>
                  <span className="shrink-0 text-[10px] text-text-dim">
                    {h.matches.length}
                  </span>
                </button>
                {h.matches.map((m) => (
                  <button
                    key={m.line}
                    type="button"
                    onClick={() => onOpen(h.path)}
                    className="block w-full truncate px-2 py-0.5 pl-6 text-left text-[11px] text-text-dim hover:bg-card hover:text-foreground"
                  >
                    <span className="mr-2 tabular-nums text-text-dim">{m.line}</span>
                    {m.text}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <div role="tree" className="min-h-0 flex-1 overflow-auto py-1">
          {rows}
          {edit && edit.kind !== "rename" && (
            <NewRow
              ext={ext}
              kind={edit.kind}
              onCommit={commitName}
              onCancel={() => setEdit(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ensureExt(name: string, ext: string): string {
  return name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-primary"
    >
      {children}
    </button>
  );
}

function NewRow({
  ext,
  kind,
  onCommit,
  onCancel,
}: {
  ext: string;
  kind: "new-file" | "new-dir";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      placeholder={kind === "new-file" ? `name.${ext}` : "folder name"}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(e.currentTarget.value);
        else if (e.key === "Escape") onCancel();
      }}
      className="mx-2 my-1 w-[210px] rounded-[2px] bg-card px-1 text-[12px] text-foreground outline-none ring-1 ring-primary/60"
    />
  );
}

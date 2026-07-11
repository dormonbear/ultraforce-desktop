import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, FolderPlus, RefreshCw, Search, X } from "lucide-react";
import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import {
  readTree,
  createFile,
  createDir,
  renameNode,
  removeNode,
  moveNode,
  type TreeNode as Node,
} from "../fs/tree";
import {
  filterTree,
  searchContent,
  type FileHit,
  type SearchOpts,
} from "../fs/search";
import { dirname, ancestorsWithin } from "../fs/paths";
import { toast } from "sonner";
import { formatIpcError } from "../errorFormat";
import { TreeNode } from "./TreeNode";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/context-menu";

interface Props {
  root: string;
  ext: "soql" | "apex";
  activePath: string | null;
  onOpen: (path: string, line?: number) => void;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (path: string) => void;
}

/** Inline "name me" row for a pending new file / folder. */
type Edit = { kind: "new-file" | "new-dir"; dir: string };

/** File-explorer sidebar for one tool's workspace root. The tree state
 * machine (expansion, focus, keyboard nav, inline rename, drag-move) is
 * headless-tree; rows and menus stay ours. */
// fallow-ignore-next-line complexity
export function Explorer({
  root,
  ext,
  activePath,
  onOpen,
  onRenamed,
  onRemoved,
}: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"name" | "content">("name");
  const [hits, setHits] = useState<FileHit[] | null>(null);
  const [opts, setOpts] = useState<SearchOpts>({});

  const refresh = useCallback(() => {
    void readTree(root).then(setNodes);
  }, [root]);
  useEffect(refresh, [refresh]);
  // Re-read when the window regains focus (cheap external-change pickup).
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  // Name-filter the tree live; when active, dirs auto-expand to reveal hits.
  const nameFilter = mode === "name" ? query.trim() : "";
  // Memoized: a fresh array identity every render would loop the tree rebuild.
  const shown = useMemo(
    () => (nameFilter ? filterTree(nodes, nameFilter, opts) : nodes),
    [nodes, nameFilter, opts],
  );

  // Path → node map backing the sync data loader. The root path maps to a
  // synthetic dir node whose children are the (filtered) top level.
  const items = useMemo(() => {
    const map = new Map<string, Node>();
    map.set(root, { path: root, name: "", kind: "dir", children: shown });
    const walk = (ns: Node[]) => {
      for (const n of ns) {
        map.set(n.path, n);
        if (n.children) walk(n.children);
      }
    };
    walk(shown);
    return map;
  }, [root, shown]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const expandedEff = useMemo(
    () =>
      nameFilter
        ? [...items.keys()].filter((id) => items.get(id)?.kind === "dir")
        : expanded,
    [nameFilter, items, expanded],
  );

  /** Expand `dir` and its ancestors so a node just created inside it is visible. */
  const revealDir = (dir: string) =>
    setExpanded((prev) => [...new Set([...prev, ...ancestorsWithin(root, dir)])]);

  const commitNew = async (name: string) => {
    const e = edit;
    setEdit(null);
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    try {
      if (e.kind === "new-file") await createFile(e.dir, ensureExt(trimmed, ext));
      else await createDir(e.dir, trimmed);
      revealDir(e.dir);
    } catch (err) {
      toast.error(formatIpcError(err));
      return;
    }
    refresh();
  };

  const commitRename = async (path: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const to = await renameNode(path, trimmed);
      onRenamed(path, to);
    } catch (err) {
      toast.error(formatIpcError(err));
      return;
    }
    refresh();
  };

  const del = async (node: Node) => {
    await removeNode(node.path, node.kind === "dir");
    onRemoved(node.path);
    refresh();
  };

  const newAt = (kind: "new-file" | "new-dir") => {
    const dir = activePath ? dirname(activePath) : root;
    setEdit({ kind, dir });
  };

  const tree = useTree<Node>({
    rootItemId: root,
    state: { expandedItems: expandedEff },
    setExpandedItems: setExpanded,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind === "dir",
    dataLoader: {
      getItem: (id) =>
        itemsRef.current.get(id) ?? { path: id, name: id, kind: "file" },
      getChildren: (id) =>
        itemsRef.current.get(id)?.children?.map((c) => c.path) ?? [],
    },
    indent: 12,
    onPrimaryAction: (item) => {
      const n = item.getItemData();
      if (n.kind === "file") onOpen(n.path);
    },
    onRename: (item, value) => void commitRename(item.getId(), value),
    // WebKit (Tauri) won't start a drag unless data is set on the transfer.
    createForeignDragObject: (dragged) => ({
      format: "text/plain",
      data: dragged.map((d) => d.getId()).join("\n"),
    }),
    canDrop: (dragged, target) =>
      dragged.every(
        (d) =>
          d.getId() !== target.item.getId() &&
          !target.item.isDescendentOf(d.getId()),
      ),
    onDrop: async (dragged, target) => {
      const t = target.item.getItemData();
      const intoDir = t.kind === "dir" ? t.path : dirname(t.path);
      for (const d of dragged) {
        const from = d.getId();
        if (dirname(from) === intoDir) continue; // already there
        try {
          const to = await moveNode(from, intoDir);
          onRenamed(from, to);
        } catch (err) {
          toast.error(formatIpcError(err));
        }
      }
      refresh();
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      renamingFeature,
      dragAndDropFeature,
    ],
  });

  // The sync data loader reads itemsRef; tell the tree when that data moved.
  useEffect(() => tree.rebuildTree(), [tree, items]);

  const runContentSearch = () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    void searchContent(nodes, q, opts).then(setHits);
  };

  // Re-run an active content search when the match options change.
  useEffect(() => {
    if (mode === "content" && query.trim()) runContentSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-background">
      <div className="flex items-center gap-1 px-2 py-1.5">
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
          onClick={() => {
            setMode((m) => (m === "name" ? "content" : "name"));
            setHits(null);
          }}
          className={`shrink-0 rounded px-1 text-[10px] font-medium ${
            mode === "content"
              ? "bg-primary/15 text-primary"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          {mode === "name" ? "Name" : "Txt"}
        </button>
        <button
          type="button"
          aria-label="Match case"
          onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
          className={`shrink-0 rounded px-1 text-[10px] font-medium ${
            opts.caseSensitive
              ? "bg-foreground/10 text-foreground"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          Aa
        </button>
        <button
          type="button"
          aria-label="Use regular expression"
          onClick={() => setOpts((o) => ({ ...o, regex: !o.regex }))}
          className={`shrink-0 rounded px-1 text-[10px] font-medium ${
            opts.regex
              ? "bg-foreground/10 text-foreground"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          .*
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
                    onClick={() => onOpen(h.path, m.line)}
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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              {...tree.getContainerProps("Files")}
              className="min-h-0 flex-1 overflow-auto py-1 outline-none"
            >
              {shown.length === 0 && !edit && (
                <div className="px-3 py-2 text-text-dim">
                  {nameFilter ? "No files match" : "No files yet"}
                </div>
              )}
              {tree.getItems().map((item) => {
                const n = item.getItemData();
                const parentDir = n.kind === "dir" ? n.path : dirname(n.path);
                return (
                  <ContextMenu key={item.getId()}>
                    <ContextMenuTrigger asChild>
                      {/* stopPropagation keeps the panel-level (blank area) menu closed for row clicks */}
                      <div onContextMenu={(e) => e.stopPropagation()}>
                        <TreeNode item={item} active={n.path === activePath} />
                      </div>
                    </ContextMenuTrigger>
                    {/* Don't restore focus to the row on close: the freshly mounted
                        rename/new-name input must keep its autofocus. */}
                    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
                      <ContextMenuItem
                        onSelect={() => setEdit({ kind: "new-file", dir: parentDir })}
                      >
                        New File
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => setEdit({ kind: "new-dir", dir: parentDir })}
                      >
                        New Folder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => item.startRenaming()}>
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive data-[highlighted]:bg-destructive/15 data-[highlighted]:text-destructive"
                        onSelect={() => void del(n)}
                      >
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              {edit && (
                <NewRow
                  ext={ext}
                  kind={edit.kind}
                  onCommit={(name) => void commitNew(name)}
                  onCancel={() => setEdit(null)}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
            <ContextMenuItem onSelect={() => setEdit({ kind: "new-file", dir: root })}>
              New File
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setEdit({ kind: "new-dir", dir: root })}>
              New Folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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
      className="mx-2 my-1 w-[210px] rounded bg-card px-1 text-[12px] text-foreground outline-none ring-1 ring-primary/60"
    />
  );
}

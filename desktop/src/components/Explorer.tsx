import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import {
  readTree,
  createFile,
  createDir,
  renameNode,
  removeNode,
  moveNode,
  type TreeNode as Node,
} from "../fs/tree";
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

  const rows: ReactElement[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      const isOpen = expanded.has(n.path);
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
  walk(tree, 0);

  return (
    <div
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-background"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void drop(root);
      }}
    >
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

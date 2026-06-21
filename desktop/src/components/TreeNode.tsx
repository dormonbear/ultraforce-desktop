import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, FileCode, Folder } from "lucide-react";
import type { TreeNode as Node } from "../fs/tree";

interface Props {
  node: Node;
  depth: number;
  expanded: boolean;
  active: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onCommitName: (name: string) => void;
  onCancelEdit: () => void;
  onDragStartNode: () => void;
  onDropOnDir: () => void;
}

/** One tree row: indent by depth, icon, label or inline-rename input. */
export function TreeNode(p: Props) {
  const { node, depth, expanded, active, editing } = p;
  const inputRef = useRef<HTMLInputElement>(null);
  const isDir = node.kind === "dir";
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div
      role="treeitem"
      aria-selected={active}
      draggable={!editing}
      onDragStart={(e) => {
        e.stopPropagation();
        p.onDragStartNode();
      }}
      onDragOver={isDir ? (e) => e.preventDefault() : undefined}
      onDrop={
        isDir
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              p.onDropOnDir();
            }
          : undefined
      }
      onClick={() => (isDir ? p.onToggle() : p.onOpen())}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`flex h-6 cursor-pointer items-center gap-1 rounded-[3px] pr-2 text-[12px] ${
        active
          ? "bg-primary/15 text-primary"
          : "text-text-dim hover:bg-card hover:text-foreground"
      }`}
    >
      {isDir ? (
        expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )
      ) : (
        <span className="w-3" />
      )}
      {isDir ? <Folder size={13} /> : <FileCode size={13} />}
      {editing ? (
        <input
          ref={inputRef}
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => p.onCommitName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") p.onCommitName(e.currentTarget.value);
            else if (e.key === "Escape") p.onCancelEdit();
          }}
          className="w-full rounded-[2px] bg-transparent text-[12px] text-foreground outline-none ring-1 ring-primary/60"
        />
      ) : (
        <span className="truncate">{node.name}</span>
      )}
    </div>
  );
}

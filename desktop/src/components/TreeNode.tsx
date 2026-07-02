import type { ItemInstance } from "@headless-tree/core";
import { ChevronRight, ChevronDown, FileCode, Folder } from "lucide-react";
import type { TreeNode as Node } from "../fs/tree";

interface Props {
  item: ItemInstance<Node>;
  active: boolean;
}

/** One tree row driven by a headless-tree item: indent by level, icon, label
 * or the inline-rename input. Click / drag / keyboard handlers all come from
 * `item.getProps()`. */
export function TreeNode({ item, active }: Props) {
  const isDir = item.isFolder();
  const level = item.getItemMeta().level;
  return (
    <div
      {...item.getProps()}
      style={{ paddingLeft: 8 + level * 12 }}
      className={`flex h-6 cursor-pointer items-center gap-1 rounded-[3px] pr-2 text-[12px] outline-none ${
        active
          ? "bg-primary/15 text-primary"
          : item.isDragTarget()
            ? "bg-primary/10 text-foreground"
            : item.isFocused()
              ? "bg-card text-foreground"
              : "text-text-dim hover:bg-card hover:text-foreground"
      }`}
    >
      {isDir ? (
        item.isExpanded() ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {isDir ? (
        <Folder size={13} className="shrink-0" />
      ) : (
        <FileCode size={13} className="shrink-0" />
      )}
      {item.isRenaming() ? (
        <input
          {...item.getRenameInputProps()}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-[2px] bg-transparent text-[12px] text-foreground outline-none ring-1 ring-primary/60"
        />
      ) : (
        <span className="truncate">{item.getItemName()}</span>
      )}
    </div>
  );
}

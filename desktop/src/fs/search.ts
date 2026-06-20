import { readTextFile } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "./tree";

/** Prune the tree to files whose name matches `query`, keeping ancestor dirs. */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "dir") {
      const kids = filterTree(n.children ?? [], q);
      if (kids.length) out.push({ ...n, children: kids });
      else if (n.name.toLowerCase().includes(q))
        out.push({ ...n, children: [] });
    } else if (n.name.toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}

export interface LineMatch {
  line: number;
  text: string;
}

/** Lines (1-based) of `content` containing `query`, trimmed. */
export function findMatches(content: string, query: string): LineMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: LineMatch[] = [];
  content.split("\n").forEach((text, i) => {
    if (text.toLowerCase().includes(q)) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

export interface FileHit {
  path: string;
  name: string;
  matches: LineMatch[];
}

/** Read each file in `nodes` and collect content matches for `query`. */
export async function searchContent(
  nodes: TreeNode[],
  query: string,
): Promise<FileHit[]> {
  const q = query.trim();
  if (!q) return [];
  const files: TreeNode[] = [];
  const collect = (ns: TreeNode[]) =>
    ns.forEach((n) =>
      n.kind === "dir" ? collect(n.children ?? []) : files.push(n),
    );
  collect(nodes);
  const hits: FileHit[] = [];
  for (const f of files) {
    try {
      const matches = findMatches(await readTextFile(f.path), q);
      if (matches.length) hits.push({ path: f.path, name: f.name, matches });
    } catch {
      /* unreadable file — skip */
    }
  }
  return hits;
}

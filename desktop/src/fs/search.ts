import { readTextFile } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "./tree";

export interface SearchOpts {
  caseSensitive?: boolean;
  regex?: boolean;
}

/** Build a line/name predicate for `query`. Invalid regex never matches. */
export function makeMatcher(
  query: string,
  opts: SearchOpts = {},
): (s: string) => boolean {
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, opts.caseSensitive ? "" : "i");
    } catch {
      return () => false;
    }
    return (s) => re.test(s);
  }
  const q = opts.caseSensitive ? query : query.toLowerCase();
  return (s) => (opts.caseSensitive ? s : s.toLowerCase()).includes(q);
}

/** Prune the tree to files whose name matches `query`, keeping ancestor dirs. */
export function filterTree(
  nodes: TreeNode[],
  query: string,
  opts?: SearchOpts,
): TreeNode[] {
  if (!query.trim()) return nodes;
  const match = makeMatcher(query.trim(), opts);
  const walk = (ns: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of ns) {
      if (n.kind === "dir") {
        const kids = walk(n.children ?? []);
        if (kids.length) out.push({ ...n, children: kids });
        else if (match(n.name)) out.push({ ...n, children: [] });
      } else if (match(n.name)) {
        out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}

export interface LineMatch {
  line: number;
  text: string;
}

/** Lines (1-based) of `content` matching `query`, trimmed. */
export function findMatches(
  content: string,
  query: string,
  opts?: SearchOpts,
): LineMatch[] {
  if (!query) return [];
  const match = makeMatcher(query, opts);
  const out: LineMatch[] = [];
  content.split("\n").forEach((text, i) => {
    if (match(text)) out.push({ line: i + 1, text: text.trim() });
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
  opts?: SearchOpts,
): Promise<FileHit[]> {
  if (!query.trim()) return [];
  const files: TreeNode[] = [];
  const collect = (ns: TreeNode[]) =>
    ns.forEach((n) =>
      n.kind === "dir" ? collect(n.children ?? []) : files.push(n),
    );
  collect(nodes);
  const hits: FileHit[] = [];
  for (const f of files) {
    try {
      const matches = findMatches(await readTextFile(f.path), query, opts);
      if (matches.length) hits.push({ path: f.path, name: f.name, matches });
    } catch {
      /* unreadable file — skip */
    }
  }
  return hits;
}

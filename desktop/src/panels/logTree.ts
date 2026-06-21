import type { ExecNodeDto } from "../types";

/** Prune an execution tree to nodes matching `query` (label or detail,
 *  case-insensitive). A matching node keeps its full subtree; a non-matching
 *  node is kept only if it has a matching descendant (so paths to matches
 *  stay visible). Empty query returns the tree unchanged. */
export function filterTree(
  nodes: ExecNodeDto[],
  query: string,
): ExecNodeDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const matches = (n: ExecNodeDto) =>
    n.label.toLowerCase().includes(q) || n.detail.toLowerCase().includes(q);

  const prune = (n: ExecNodeDto): ExecNodeDto | null => {
    if (matches(n)) return n;
    const children = n.children
      .map(prune)
      .filter((c): c is ExecNodeDto => c !== null);
    return children.length ? { ...n, children } : null;
  };

  return nodes
    .map(prune)
    .filter((n): n is ExecNodeDto => n !== null);
}

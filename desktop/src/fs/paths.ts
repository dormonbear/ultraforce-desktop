/** Infer only explicit Windows absolute syntax. Backslashes in POSIX filenames
 * remain literal. Do not case-fold filenames: Windows also supports
 * case-sensitive directories. Drive letters share one identity.
 */
function isWindows(path: string): boolean {
  return /^[a-z]:[/\\]/i.test(path) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(path);
}

/** Keep native roots intact and give mixed Windows separators one identity. */
export function normalizePath(path: string): string {
  if (!isWindows(path)) return path.replace(/\/+$/, "") || (path ? "/" : "");
  const native = path.replace(/\//g, "\\");
  const root = /^[a-z]:\\/i.test(native)
    ? native[0].toUpperCase() + ":\\"
    : /^\\\\[^\\]+\\[^\\]+/.exec(native)![0] + "\\";
  const rest = native.slice(root.length).replace(/^\\+|\\+$/g, "");
  return root + rest;
}

function separator(path: string): string {
  return isWindows(path) ? "\\" : "/";
}

export function joinPath(...parts: string[]): string {
  const first = parts.findIndex(Boolean);
  if (first === -1) return "";
  const base = normalizePath(parts[first]);
  const sep = separator(base);
  const tail = parts
    .slice(first + 1)
    .map((part) => {
      const value = sep === "\\" ? part.replace(/\//g, "\\") : part;
      return sep === "\\"
        ? value.replace(/^\\+|\\+$/g, "")
        : value.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean);
  return tail.length
    ? base + (base.endsWith(sep) ? "" : sep) + tail.join(sep)
    : base;
}

export function basename(path: string): string {
  const value = normalizePath(path);
  const i = value.lastIndexOf(separator(value));
  return value.slice(i + 1);
}

export function dirname(path: string): string {
  const value = normalizePath(path);
  const sep = separator(value);
  const i = value.lastIndexOf(sep);
  if (i < 0) return "";
  return normalizePath(
    value.slice(0, i + (i === 0 || (sep === "\\" && i === 2) ? 1 : 0)),
  );
}

/** Exact path or descendant, with a separator boundary (never a sibling prefix). */
export function isWithin(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  if (p === r) return true;
  if (!r) return false;
  const prefix = r.endsWith(separator(r)) ? r : r + separator(r);
  return p.startsWith(prefix);
}

/** Rebase a path already checked by isWithin; preserve POSIX literal backslashes. */
export function rebasePath(path: string, from: string, to: string): string {
  const value = normalizePath(path);
  const root = normalizePath(from);
  if (value === root) return normalizePath(to);
  return joinPath(
    to,
    ...value.slice(root.length).split(separator(root)).filter(Boolean),
  );
}

/** `dir` and its parent dirs strictly below `root` (for expanding a tree). */
export function ancestorsWithin(root: string, dir: string): string[] {
  const base = normalizePath(root);
  const chain: string[] = [];
  let p = normalizePath(dir);
  while (p !== base && isWithin(p, base)) {
    chain.push(p);
    const parent = dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return chain;
}

export function movedPath(itemPath: string, intoDir: string): string {
  return joinPath(intoDir, basename(itemPath));
}

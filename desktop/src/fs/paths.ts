/** POSIX-style path helpers (Tauri paths use forward slashes on macOS/Linux). */
export function joinPath(...parts: string[]): string {
  const body = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${body}`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

/** `dir` and its parent dirs strictly below `root` (for expanding a tree to reveal it). */
export function ancestorsWithin(root: string, dir: string): string[] {
  const chain: string[] = [];
  let p = dir;
  while (p.startsWith(`${root}/`)) {
    chain.push(p);
    p = dirname(p);
  }
  return chain;
}

/** New path when `itemPath` moves into `intoDir`. */
export function movedPath(itemPath: string, intoDir: string): string {
  return joinPath(intoDir, basename(itemPath));
}

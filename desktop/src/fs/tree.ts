import {
  mkdir,
  readDir,
  rename,
  remove,
  writeTextFile,
  type DirEntry,
} from "@tauri-apps/plugin-fs";
import { joinPath, dirname, movedPath } from "./paths";

export type TreeNode = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: TreeNode[];
};

type Entry = { name: string; isDirectory: boolean };

/** Dirs before files; each group sorted case-insensitively by name. */
export function sortEntries<T extends Entry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

async function readInto(dir: string): Promise<TreeNode[]> {
  const entries = (await readDir(dir)) as DirEntry[];
  const nodes: TreeNode[] = [];
  for (const e of sortEntries(entries)) {
    const path = joinPath(dir, e.name);
    nodes.push(
      e.isDirectory
        ? { path, name: e.name, kind: "dir", children: await readInto(path) }
        : { path, name: e.name, kind: "file" },
    );
  }
  return nodes;
}

export function readTree(root: string): Promise<TreeNode[]> {
  return readInto(root);
}

export async function createFile(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name);
  await writeTextFile(path, "");
  return path;
}

export async function createDir(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name);
  await mkdir(path, { recursive: true });
  return path;
}

export async function renameNode(path: string, newName: string): Promise<string> {
  const next = joinPath(dirname(path), newName);
  await rename(path, next);
  return next;
}

export async function removeNode(path: string, isDir: boolean): Promise<void> {
  await remove(path, { recursive: isDir });
}

export async function moveNode(path: string, intoDir: string): Promise<string> {
  const next = movedPath(path, intoDir);
  await rename(path, next);
  return next;
}

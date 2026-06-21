export interface SyncResult {
  org: string;
  added: number;
  updated: number;
  removed: number;
}

/** "Synced N update(s)" — N = added + updated + removed. */
export function syncLabel(r: SyncResult): string {
  const n = r.added + r.updated + r.removed;
  return `Synced ${n} ${n === 1 ? "update" : "updates"}`;
}

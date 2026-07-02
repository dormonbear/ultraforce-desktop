/** Format a nanosecond duration as a compact millisecond string. */
export function formatMs(durNs: number): string {
  return `${(durNs / 1_000_000).toFixed(durNs < 1_000_000 ? 3 : 2)} ms`;
}

/** Format a byte count compactly (B / KB / MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

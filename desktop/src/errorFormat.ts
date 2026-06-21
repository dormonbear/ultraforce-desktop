/** A backend error string split into a friendly headline + the raw original. */
export interface ParsedError {
  /** Humanized error name, e.g. "Malformed query". */
  title: string;
  /** The underlying message, e.g. "unexpected token: 'SE'". */
  detail: string;
  /** The original backend string, kept verbatim for debugging. */
  raw: string;
}

/** SCREAMING_SNAKE → "Sentence case", e.g. MALFORMED_QUERY → "Malformed query". */
function humanize(name: string): string {
  const words = name.replace(/_/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Error";
}

/**
 * Parse a backend error. The Tauri commands forward `format!("{e:?}")`, so an
 * `sf` command failure arrives as
 * `Command { status: 1, name: "MALFORMED_QUERY", message: "unexpected token: 'SE'" }`.
 * Extract a friendly title + message from that shape; fall back to the raw
 * string for any other error. The raw is always preserved.
 */
export function parseSfError(raw: string): ParsedError {
  const m = raw.match(/name:\s*"([^"]*)",\s*message:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    return { title: humanize(m[1]), detail: m[2].replace(/\\"/g, '"'), raw };
  }
  return { title: "Error", detail: raw, raw };
}

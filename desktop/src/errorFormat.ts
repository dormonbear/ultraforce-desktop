/** A backend error string split into a friendly headline + the raw original. */
export interface ParsedError {
  /** Humanized error name, e.g. "Malformed query". */
  title: string;
  /** The underlying message, e.g. "unexpected token: 'SE'". */
  detail: string;
  /** The original backend string, kept verbatim for debugging. */
  raw: string;
}

/** Whether a backend error means the `sf` CLI itself is unavailable (not on
 * PATH), rather than a query/command error — so the UI can show install/PATH
 * guidance instead of the raw message. Matches `SfError::NotFound`'s text. */
export function isCliUnavailable(message: string): boolean {
  return /CLI not found on PATH|install the Salesforce CLI/i.test(message);
}

/** SCREAMING_SNAKE → "Sentence case", e.g. MALFORMED_QUERY → "Malformed query". */
function humanize(name: string): string {
  const words = name.replace(/_/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Error";
}

/**
 * Un-escape a Rust `Debug`-formatted string literal back to its real text. The
 * backend forwards `format!("{e:?}")`, so an `sf` message with real newlines
 * arrives with them escaped as the two characters `\n` — turn those (and `\t`,
 * `\r`, `\"`, `\\`, `\u{..}`) back into the characters they represent so the
 * message renders as the multi-line text `sf` actually returned.
 */
function unescapeDebug(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|.)/g, (_, esc: string) => {
    switch (esc) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case '"':
      case "\\":
      case "'":
        return esc.slice(-1);
      default:
        return esc[0] === "u"
          ? String.fromCodePoint(parseInt(esc.slice(2, -1), 16))
          : esc;
    }
  });
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
    return { title: humanize(m[1]), detail: unescapeDebug(m[2]).trim(), raw };
  }
  return { title: "Error", detail: raw, raw };
}

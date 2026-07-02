/** A backend error string split into a friendly headline + the raw original. */
export interface ParsedError {
  /** Humanized error name, e.g. "Malformed query". */
  title: string;
  /** The underlying message, e.g. "unexpected token: 'SE'". */
  detail: string;
  /** The original backend string, kept verbatim for debugging. */
  raw: string;
}

/**
 * Normalize an unknown IPC rejection into a display string. Tauri commands
 * reject with a serialized `CommandError { code, message }` object; plugin
 * and legacy paths may still reject with a plain string.
 */
export function formatIpcError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(e);
}

/** Whether a backend error means the `sf` CLI itself is unavailable (not on
 * PATH), rather than a query/command error — so the UI can show install/PATH
 * guidance instead of the raw message. Matches `SfError::NotFound`'s text. */
export function isCliUnavailable(message: string): boolean {
  return /CLI not found on PATH|install the Salesforce CLI/i.test(message);
}

/** Salesforce reports a missing object permission as INVALID_TYPE
 * ("sObject type 'ApexLog' is not supported") — querying ApexLog needs the
 * "View All Data" permission. Detect it so the UI can explain instead of
 * echoing the raw SOQL error. */
export function isApexLogAccessDenied(message: string): boolean {
  return /INVALID_TYPE/.test(message) && /'ApexLog' is not supported/.test(message);
}

export const APEX_LOG_ACCESS_HINT =
  "This org user can't view debug logs: querying ApexLog requires the " +
  '"View All Data" permission. Ask an admin to grant it (or use a user that has it), then Refresh.';

/** SCREAMING_SNAKE → "Sentence case", e.g. MALFORMED_QUERY → "Malformed query". */
function humanize(name: string): string {
  const words = name.replace(/_/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Error";
}

/**
 * Parse a backend error message. The Tauri commands forward `SfError`'s
 * `Display` text, so an `sf` command failure arrives as
 * `` `sf` command failed (status 1): MALFORMED_QUERY: unexpected token: 'SE' ``.
 * Extract a friendly title + message from that shape; fall back to the raw
 * string for any other error. The raw is always preserved.
 */
export function parseSfError(raw: string): ParsedError {
  const m = raw.match(/^`sf` command failed \(status -?\d+\): ([^:]+): ([\s\S]*)$/);
  if (m) {
    return { title: humanize(m[1]), detail: m[2].trim(), raw };
  }
  return { title: "Error", detail: raw, raw };
}

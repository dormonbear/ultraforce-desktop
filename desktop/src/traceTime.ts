const pad2 = (n: number) => String(n).padStart(2, "0");

/** sf datetime literal for `ms` epoch millis, in UTC: `YYYY-MM-DDThh:mm:ss.000+0000`. */
function toSfIso(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.000+0000`
  );
}

/** sf datetime literal `N` hours from now. */
export function isoIn(hoursFromNow: number): string {
  return toSfIso(Date.now() + hoursFromNow * 3_600_000);
}

/** sf datetime literal `N` hours after `iso` (after now when `iso` is empty/invalid). */
export function isoPlusHours(iso: string | null, hoursToAdd: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  return toSfIso((Number.isNaN(t) ? Date.now() : t) + hoursToAdd * 3_600_000);
}

/** True if `iso` is a parseable timestamp in the past. */
export function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

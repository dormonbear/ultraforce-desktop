/** Convert an ISO8601 datetime (e.g. `2026-05-11T05:52:56.000+0000` or
 * `...Z`) to a `datetime-local`-compatible LOCAL string `YYYY-MM-DDTHH:mm:ss`.
 * Empty/invalid input yields `""`. */
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Inverse of {@link isoToLocalInput}: a `datetime-local` string (interpreted
 * as local time) to an ISO8601 string the backend accepts. Empty/invalid
 * input yields `""`. */
export function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

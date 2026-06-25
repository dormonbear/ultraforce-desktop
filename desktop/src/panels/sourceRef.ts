/** A class + (optional) line parsed from a log node detail or hotspot signature,
 * used to jump to the Apex source. */
export interface SourceRef {
  className: string;
  line: number | null;
}

/** Pull the class name and line from text like `[15] | 01p | MyClass.doWork()`
 * or a hotspot signature `MyClass.doWork()`. Returns null when there's no
 * `Class.method(` shape to resolve. For `ns.MyClass.m()` the class is `MyClass`. */
export function parseSourceRef(text: string): SourceRef | null {
  const m = text.match(/([A-Za-z_]\w*)\.\w+\s*\(/);
  if (!m) return null;
  const lineM = text.match(/\[(\d+)\]/);
  return { className: m[1], line: lineM ? Number(lineM[1]) : null };
}

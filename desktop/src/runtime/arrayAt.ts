const fallback = {
  at(this: unknown, index?: unknown): unknown {
    if (this === null || this === undefined) {
      throw new TypeError("Array.at requires a receiver / Array.at 需要接收者");
    }
    const receiver = Object(this) as { length: unknown; [key: number]: unknown };
    // Unary plus preserves ToNumber's BigInt/Symbol rejection. / 一元加保留 ToNumber 对 BigInt／Symbol 的拒绝行为。
    const size = Math.trunc(+(receiver.length as number));
    const length = Number.isNaN(size) ? 0 : Math.min(Math.max(size, 0), Number.MAX_SAFE_INTEGER);
    const relative = Math.trunc(+(index as number)) || 0;
    const key = relative < 0 ? length + relative : relative;
    return key < 0 || key >= length ? undefined : receiver[key];
  },
}.at;

/** Install only the missing generic array method; keep native implementations. / 仅补齐缺失的通用数组方法，保留原生实现。 */
export function ensureArrayAt(prototype: object = Array.prototype): void {
  if (typeof Reflect.get(prototype, "at") === "function") return;
  Object.defineProperty(prototype, "at", { value: fallback, configurable: true, writable: true });
  const previous = Reflect.get(prototype, Symbol.unscopables);
  const exclusions: Record<string, boolean> = previous && typeof previous === "object"
    ? previous : Object.create(null);
  exclusions.at = true;
  if (exclusions !== previous) {
    Object.defineProperty(prototype, Symbol.unscopables, { value: exclusions, configurable: true });
  }
}

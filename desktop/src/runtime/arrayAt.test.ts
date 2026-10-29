import { expect, it } from "vitest";
import { ensureArrayAt } from "./arrayAt";

const nativeAt = Array.prototype.at;
function installed(): Function {
  const prototype = {};
  ensureArrayAt(prototype);
  return Reflect.get(prototype, "at");
}
const cases: { label: string; receiver: unknown; index: unknown }[] = [
  ...[undefined, 0, 1, -1, -3, -4, 3, 1.9, -1.9, NaN, Infinity, -Infinity, "1", null, true].map((index) => ({ label: String(index), receiver: ["a", "b", "c"], index })),
  { label: "sparse / 稀疏", receiver: Object.assign(Array(2), { 1: "b" }), index: 0 },
  { label: "typed / 类型数组", receiver: new Uint8Array([10, 20]), index: -1 },
  { label: "UTF-16 / UTF-16", receiver: "A😀", index: -1 },
  { label: "fractional length / 小数长度", receiver: { 0: "a", 1: "b", length: 1.9 }, index: -1 },
  { label: "negative length / 负长度", receiver: { 0: "a", length: -1 }, index: 0 },
  { label: "bounded infinite length / 无限长度截断", receiver: { [Number.MAX_SAFE_INTEGER - 1]: "last", length: Infinity }, index: -1 },
];
it.each(cases)("matches native at: $label / 与原生 at 一致", ({ receiver, index }) => {
  expect(Reflect.apply(installed(), receiver, [index])).toBe(Reflect.apply(nativeAt, receiver, [index]));
});
it.each([
  { receiver: null, index: 0 }, { receiver: undefined, index: 0 },
  { receiver: [], index: 1n }, { receiver: [], index: Symbol("owned") },
  { receiver: { length: 1n }, index: 0 }, { receiver: { length: Symbol("owned") }, index: 0 },
])("rejects invalid receivers and numeric conversions / 拒绝无效接收者及数值转换", ({ receiver, index }) => {
  expect(() => Reflect.apply(nativeAt, receiver, [index])).toThrow(TypeError);
  expect(() => Reflect.apply(installed(), receiver, [index])).toThrow(TypeError);
});
it("reads length before index and only reads an in-range property / 先读长度再转换索引且仅访问范围内属性", () => {
  const calls: string[] = [];
  const receiver = { get length() { calls.push("length"); return 1; }, get 0() { calls.push("item"); return "a"; } };
  const index = { valueOf() { calls.push("index"); return 0; } };
  expect(Reflect.apply(installed(), receiver, [index])).toBe("a");
  expect(calls).toEqual(["length", "index", "item"]);
});
it("preserves native identity and installs non-enumerable method semantics / 保留原生标识及非枚举方法语义", () => {
  const native = { at: nativeAt };
  ensureArrayAt(native);
  expect(native.at).toBe(nativeAt);
  const prototype = {};
  ensureArrayAt(prototype);
  const method = Reflect.get(prototype, "at");
  expect(Object.getOwnPropertyDescriptor(prototype, "at")).toMatchObject({ enumerable: false, configurable: true, writable: true });
  expect(method.name).toBe("at");
  expect(method.length).toBe(1);
  expect(() => Reflect.construct(method, [0])).toThrow(TypeError);
  ensureArrayAt(prototype);
  expect(Reflect.get(prototype, "at")).toBe(method);
  expect(Reflect.get(prototype, Symbol.unscopables).at).toBe(true);
  expect(Object.getPrototypeOf(Reflect.get(prototype, Symbol.unscopables))).toBeNull();
});

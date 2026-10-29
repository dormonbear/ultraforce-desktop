import { describe, expect, it, vi } from "vitest";
import { ensureRandomUUID } from "./randomUUID";

describe("randomUUID compatibility / randomUUID 兼容性", () => {
  it("keeps a native implementation untouched / 保留原生实现", () => {
    const native = vi.fn(() => "native-id");
    const random = vi.fn((bytes: Uint8Array) => bytes);
    const source = { randomUUID: native, getRandomValues: random };

    ensureRandomUUID(source);

    expect(source.randomUUID).toBe(native);
    expect(source.randomUUID()).toBe("native-id");
    expect(random).not.toHaveBeenCalled();
  });

  it("uses fresh random bytes and sets UUID version and variant bits / 使用新的随机字节并设置 UUID 版本及变体位", () => {
    let start = 0;
    const random = vi.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = start + i;
      start += 16;
      return bytes;
    });
    const source: { getRandomValues: typeof random; randomUUID?: () => string } = { getRandomValues: random };

    ensureRandomUUID(source);
    const installed = source.randomUUID;
    ensureRandomUUID(source);
    expect(source.randomUUID).toBe(installed);

    expect(source.randomUUID?.()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(source.randomUUID?.()).toBe("10111213-1415-4617-9819-1a1b1c1d1e1f");
    expect(random).toHaveBeenCalledTimes(2);
    expect(random.mock.calls.map(([bytes]) => bytes.length)).toEqual([16, 16]);
  });

  it("does not install an insecure substitute without random bytes / 没有安全随机字节时不安装不安全替代品", () => {
    const source: { randomUUID?: () => string } = {};

    ensureRandomUUID(source);

    expect(source.randomUUID).toBeUndefined();
  });

  it("propagates random-source errors / 传播随机源错误", () => {
    const failure = new Error("Synthetic random source failure / 合成随机源失败");
    const source: { getRandomValues: (bytes: Uint8Array) => Uint8Array; randomUUID?: () => string } = {
      getRandomValues: () => { throw failure; },
    };

    ensureRandomUUID(source);

    expect(() => source.randomUUID?.()).toThrow(failure);
  });
});

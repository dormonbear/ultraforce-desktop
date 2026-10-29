type RandomUUIDSource = {
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

/** Install a v4 UUID method only when secure random bytes are available. / 仅在有安全随机字节时补齐 v4 UUID 方法。 */
export function ensureRandomUUID(source: RandomUUIDSource | undefined = globalThis.crypto): void {
  if (!source || typeof source.randomUUID === "function" || typeof source.getRandomValues !== "function") return;
  const randomBytes = source.getRandomValues.bind(source);
  Object.defineProperty(source, "randomUUID", {
    configurable: true,
    writable: true,
    value: function randomUUID(): string {
      const bytes = randomBytes(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

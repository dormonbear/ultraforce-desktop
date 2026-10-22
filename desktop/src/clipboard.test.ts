import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { copyText } from "./clipboard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const payload = "System.debug('{org}');\nSELECT Id FROM Account";

function navigatorFor(locale: string, writeText?: (text: string) => Promise<void>) {
  vi.stubGlobal("navigator", {
    languages: [locale], language: locale,
    clipboard: writeText ? { writeText } : undefined,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

for (const locale of ["en-US", "zh-CN"]) {
  describe(`clipboard locale / 剪贴板语言: ${locale}`, () => {
    it("localizes default success without changing content / 本地化默认成功提示且不改变内容", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      navigatorFor(locale, writeText);
      await copyText(payload);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(payload);
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(locale === "zh-CN" ? "已复制" : "Copied");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("preserves explicit and empty success messages / 保留显式和空的成功提示", async () => {
      navigatorFor(locale, vi.fn().mockResolvedValue(undefined));
      await copyText(payload, "raw {source} / 原始 {source}");
      await copyText(payload, "");
      expect(vi.mocked(toast.success).mock.calls).toEqual([["raw {source} / 原始 {source}"], [""]]);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("localizes rejected writes without exposing the error / 本地化被拒绝的写入且不暴露错误", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("synthetic denial / 合成拒绝"));
      navigatorFor(locale, writeText);
      await expect(copyText(payload)).resolves.toBeUndefined();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(payload);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(locale === "zh-CN" ? "复制失败" : "Copy failed");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("handles an unavailable clipboard in the current locale / 按当前语言处理不可用的剪贴板", async () => {
      navigatorFor(locale);
      await expect(copyText(payload)).resolves.toBeUndefined();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(locale === "zh-CN" ? "复制失败" : "Copy failed");
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
}

it("uses the completion-time locale for pending writes / 等待写入时采用完成时的语言", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const writeText = vi.fn().mockReturnValue(pending);
  navigatorFor("en-US", writeText);
  const copied = copyText(payload);
  expect(toast.success).not.toHaveBeenCalled();
  navigatorFor("zh-CN", writeText);
  finish();
  await copied;
  expect(toast.success).toHaveBeenCalledExactlyOnceWith("已复制");
});

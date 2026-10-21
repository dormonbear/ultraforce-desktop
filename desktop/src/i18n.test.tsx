// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocale, translate, useI18n } from "./i18n";

function Control() {
  const { locale, t } = useI18n();
  return <button lang={locale}>{t("Settings")}</button>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("system language / 系统语言", () => {
  it.each([
    [["zh-CN", "en-US"], "zh-CN"],
    [["en-GB", "zh-CN"], "en"],
    [["fr-FR", "zh-Hans"], "zh-CN"],
    [["zh_SG"], "zh-CN"],
    [["ja-JP"], "en"],
    [[], "en"],
  ] as const)("selects the first supported language / 选择首个支持的语言: %j", (languages, expected) => {
    expect(resolveLocale(languages)).toBe(expected);
  });

  it("keeps substituted errors literal / 保留错误参数原文", () => {
    const error = "<script>{tool}$&</script>";
    expect(translate("zh-CN", "Reindex failed: {error}", { error }))
      .toBe(`重新索引失败：${error}`);
    expect(translate("en", "{tool} workspace", { tool: "soql" })).toBe("soql workspace");
  });

  it("updates mounted controls when the OS language changes / 系统语言变化时更新已挂载控件", () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    render(<Control />);
    expect(screen.getByRole("button", { name: "Settings" }).lang).toBe("en");
    languages.mockReturnValue(["zh-CN"]);
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByRole("button", { name: "设置" }).lang).toBe("zh-CN");
    languages.mockReturnValue(["de-DE"]);
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByRole("button", { name: "Settings" }).lang).toBe("en");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { setTrayLocale } from "./window";

describe("tray locale updates / 托盘语言更新", () => {
  beforeEach(() => invoke.mockReset());

  it("applies rapid language changes in order / 按顺序应用快速语言变化", async () => {
    let finish = () => {};
    invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    invoke.mockResolvedValueOnce(null);
    const first = setTrayLocale("en");
    const second = setTrayLocale("zh-CN");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenNthCalledWith(1, "set_tray_locale", { locale: "en" });
    finish();
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenNthCalledWith(2, "set_tray_locale", { locale: "zh-CN" });
  });

  it("continues after an update fails / 更新失败后继续处理后续变化", async () => {
    invoke.mockRejectedValueOnce(new Error("Synthetic failure / 合成失败"));
    invoke.mockResolvedValueOnce(null);
    const first = setTrayLocale("en");
    const second = setTrayLocale("zh-CN");
    await expect(first).rejects.toThrow("Synthetic failure / 合成失败");
    await second;
    expect(invoke).toHaveBeenLastCalledWith("set_tray_locale", { locale: "zh-CN" });
  });

  it("preserves a structured native failure and processes the next update / 保留结构化原生错误并处理后续更新", async () => {
    const failure = { code: "tray", message: "Could not update tray menu / 无法更新托盘菜单" };
    invoke.mockRejectedValueOnce(failure);
    invoke.mockResolvedValueOnce(null);
    const first = setTrayLocale("en");
    const second = setTrayLocale("zh-CN");
    await expect(first).rejects.toEqual(failure);
    await second;
    expect(invoke).toHaveBeenLastCalledWith("set_tray_locale", { locale: "zh-CN" });
  });
});

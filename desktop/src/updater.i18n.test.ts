import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "./updater";

const mock = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  notice: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mock.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mock.relaunch }));
vi.mock("sonner", () => ({
  toast: Object.assign(mock.notice, {
    loading: mock.loading, dismiss: mock.dismiss, success: mock.success, error: mock.error,
  }),
}));

function locale(language: string) {
  vi.stubGlobal("navigator", { languages: [language], language });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.loading.mockReturnValue("loading-id");
  mock.relaunch.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

for (const language of ["en-US", "zh-CN"]) {
  const zh = language === "zh-CN";
  describe(`update locale / 更新语言: ${language}`, () => {
    it("localizes a manual check and current status / 本地化手动检查及最新状态", async () => {
      locale(language);
      mock.check.mockResolvedValue(null);
      await checkForUpdates(true);
      expect(mock.loading).toHaveBeenCalledExactlyOnceWith(zh ? "正在检查更新…" : "Checking for updates…");
      expect(mock.dismiss).toHaveBeenCalledExactlyOnceWith("loading-id");
      expect(mock.success).toHaveBeenCalledExactlyOnceWith(zh ? "已是最新版本" : "You're up to date");
    });

    it("localizes the offer while preserving release notes and installation / 本地化更新提示并保留发布说明及安装行为", async () => {
      locale(language);
      const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
      const notes = "Release {version} / 发布 {version}";
      mock.check.mockResolvedValue({ version: "1.2.3", body: notes, downloadAndInstall });
      await checkForUpdates();
      const [title, options] = mock.notice.mock.calls[0];
      expect(title).toBe(zh ? "更新 1.2.3 可用" : "Update 1.2.3 available");
      expect(options.description).toBe(notes);
      expect(options.action.label).toBe(zh ? "安装并重新启动" : "Install & restart");
      options.action.onClick();
      await vi.waitFor(() => expect(mock.relaunch).toHaveBeenCalledExactlyOnceWith());
      expect(downloadAndInstall).toHaveBeenCalledExactlyOnceWith();
      expect(mock.loading).toHaveBeenCalledExactlyOnceWith(zh ? "正在下载更新…" : "Downloading update…");
      expect(mock.dismiss).toHaveBeenCalledExactlyOnceWith("loading-id");
    });

    it("localizes manual failures and keeps startup failures silent / 本地化手动检查错误且保持启动检查静默", async () => {
      locale(language);
      mock.check.mockRejectedValue("synthetic failure / 合成故障");
      await checkForUpdates(true);
      expect(mock.error).toHaveBeenCalledExactlyOnceWith(
        zh ? "检查更新失败：synthetic failure / 合成故障" : "Update check failed: synthetic failure / 合成故障",
      );
      mock.error.mockClear();
      mock.loading.mockClear();
      await checkForUpdates();
      expect(mock.error).not.toHaveBeenCalled();
      expect(mock.loading).not.toHaveBeenCalled();
    });

    it("localizes fallback notes and install failures / 本地化默认说明及安装错误", async () => {
      locale(language);
      mock.check.mockResolvedValue({
        version: "1.2.3", body: "", downloadAndInstall: vi.fn().mockRejectedValue("synthetic failure / 合成故障"),
      });
      await checkForUpdates();
      const [, options] = mock.notice.mock.calls[0];
      expect(options.description).toBe(zh ? "新版本已准备好安装。" : "A new version is ready to install.");
      options.action.onClick();
      await vi.waitFor(() => expect(mock.error).toHaveBeenCalledExactlyOnceWith(
        zh ? "更新失败：synthetic failure / 合成故障" : "Update failed: synthetic failure / 合成故障",
      ));
      expect(mock.relaunch).not.toHaveBeenCalled();
    });
  });
}

it("uses the current language when a pending check completes / 等待检查完成时使用当前语言", async () => {
  locale("en-US");
  let finish!: (value: null) => void;
  mock.check.mockReturnValue(new Promise<null>(resolve => { finish = resolve; }));
  const pending = checkForUpdates(true);
  locale("zh-CN");
  finish(null);
  await pending;
  expect(mock.loading).toHaveBeenCalledExactlyOnceWith("Checking for updates…");
  expect(mock.success).toHaveBeenCalledExactlyOnceWith("已是最新版本");
});

it("uses the current language when installation begins / 开始安装时使用当前语言", async () => {
  locale("en-US");
  mock.check.mockResolvedValue({
    version: "1.2.3", body: "", downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  });
  await checkForUpdates();
  const [, options] = mock.notice.mock.calls[0];
  locale("zh-CN");
  options.action.onClick();
  await vi.waitFor(() => expect(mock.relaunch).toHaveBeenCalledExactlyOnceWith());
  expect(mock.loading).toHaveBeenCalledExactlyOnceWith("正在下载更新…");
});

it("reuses an offer for the same version while distinguishing versions / 同一版本复用提示并区分不同版本", async () => {
  locale("en-US");
  mock.check.mockResolvedValue({ version: "1.2.3", body: "" });
  await checkForUpdates();
  await checkForUpdates();
  mock.check.mockResolvedValue({ version: "1.2.4", body: "" });
  await checkForUpdates();

  const ids = mock.notice.mock.calls.map(([, options]) => options.id);
  expect(typeof ids[0]).toBe("string");
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
});

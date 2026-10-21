import { useSyncExternalStore } from "react";

const chinese = {
  SOQL: "SOQL",
  Apex: "Apex",
  Logs: "日志",
  Schema: "对象结构",
  Settings: "设置",
  "Coming soon": "即将推出",
  Appearance: "外观",
  Theme: "主题",
  Light: "浅色",
  Dark: "深色",
  "Syntax highlighting": "语法高亮",
  "Syntax highlighting scheme": "语法高亮配色",
  "syntax highlighting preview": "语法高亮预览",
  Workspace: "工作区",
  "{tool} workspace": "{tool} 工作区",
  "Change…": "更改…",
  Reset: "重置",
  "Confirm before running anonymous Apex": "运行匿名 Apex 前确认",
  "Ask for confirmation on every run — a guard against executing DML in the wrong org.":
    "每次运行前请求确认，防止在错误的组织中执行 DML。",
  Privacy: "隐私",
  "No analytics, telemetry, usage tracking, or automatic crash reports are collected or sent.":
    "不收集或发送分析数据、遥测、使用记录或自动崩溃报告。",
  "Your scripts, execution history, preferences, Salesforce logs and schema indexes stay on this computer. Salesforce operations communicate with your selected org. Update checks contact GitHub Releases.":
    "脚本、执行历史、偏好设置、Salesforce 日志及对象结构索引保存在本机。Salesforce 操作与所选组织通信；更新检查访问 GitHub Releases。",
  "Apex History keeps your last 50 runs locally; use Clear history in the History drawer to remove them. Opened Salesforce logs are cached locally for reopening.":
    "Apex 历史在本地保留最近 50 次运行，可在历史面板中清除。已打开的 Salesforce 日志缓存在本地，以便再次打开。",
  Indexing: "索引",
  "Index scope": "索引范围",
  "All objects": "所有对象",
  "Unmanaged only (skip managed packages)": "仅未托管内容（跳过托管包）",
  "Reindexing org…": "正在重新索引组织…",
  "Reindex failed: {error}": "重新索引失败：{error}",
  About: "关于",
  "Check for updates": "检查更新",
  "Checking Salesforce CLI…": "正在检查 Salesforce CLI…",
  "Connect a Salesforce org": "连接 Salesforce 组织",
  "Log in via your browser. Pick the environment, optionally set an alias.":
    "通过浏览器登录。选择环境，也可设置别名。",
  "Copied to clipboard": "已复制到剪贴板",
  "Copy failed": "复制失败",
  "Copy command": "复制命令",
  Retry: "重试",
  "Salesforce CLI is too old": "Salesforce CLI 版本过旧",
  "Ultraforce needs sf {minimum} or newer. Detected: {version}. Upgrade, then retry.":
    "Ultraforce 需要 sf {minimum} 或更高版本。检测到：{version}。请升级后重试。",
  "Ultraforce needs sf {minimum} or newer. Upgrade, then retry.":
    "Ultraforce 需要 sf {minimum} 或更高版本。请升级后重试。",
  "Docs:": "文档：",
  "Salesforce CLI not on this app’s PATH": "应用的 PATH 中未找到 Salesforce CLI",
  "sf is installed at {path}, but Ultraforce can’t see it. This happens when the app is launched from the Dock, or with shells like fish.":
    "sf 已安装于 {path}，但 Ultraforce 无法访问。从 Dock 启动应用或使用 fish 等 shell 时可能出现此问题。",
  "sf is installed, but Ultraforce can’t see it. This happens when the app is launched from the Dock, or with shells like fish.":
    "sf 已安装，但 Ultraforce 无法访问。从 Dock 启动应用或使用 fish 等 shell 时可能出现此问题。",
  "Fix: relaunch Ultraforce from a terminal, or add sf’s directory to your login shell’s PATH, then retry.":
    "解决方法：从终端重新启动 Ultraforce，或将 sf 所在目录加入登录 shell 的 PATH，然后重试。",
  "Salesforce CLI not found": "未找到 Salesforce CLI",
  "Ultraforce drives the sf CLI. Install it, then retry.":
    "Ultraforce 通过 sf CLI 执行操作。请安装后重试。",
  "Or use the installer — docs:": "也可使用安装程序，文档：",
  "Enter a custom instance URL": "请输入自定义实例 URL",
  "Org connected": "组织已连接",
  Environment: "环境",
  "Production / Developer (login.salesforce.com)": "生产 / 开发者组织（login.salesforce.com）",
  "Sandbox (test.salesforce.com)": "沙盒（test.salesforce.com）",
  "Custom domain / My Domain…": "自定义域名 / 我的域…",
  "Instance URL": "实例 URL",
  "Alias (optional)": "别名（可选）",
  "Waiting for browser…": "正在等待浏览器…",
  "Log in": "登录",
  Close: "关闭",
} as const;

export type Locale = "en" | "zh-CN";
export type MessageKey = keyof typeof chinese;

export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const message = locale === "zh-CN" ? chinese[key] : key;
  // Replace in one pass so values are never interpreted as message templates. / 单次替换，避免将参数值解释为消息模板。
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}

function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return resolveLocale(navigator.languages.length ? navigator.languages : [navigator.language]);
}

function subscribe(callback: () => void) {
  window.addEventListener("languagechange", callback);
  return () => window.removeEventListener("languagechange", callback);
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, browserLocale, () => "en" as Locale);
  return {
    locale,
    t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) =>
      translate(locale, key, values),
  };
}

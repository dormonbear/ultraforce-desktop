import { useCallback, useSyncExternalStore } from "react";

const chinese = {
  SOQL: "SOQL",
  Query: "查询",
  "All rows": "所有行",
  Run: "运行",
  Running: "运行中",
  Apex: "Apex",
  "Anonymous Apex": "匿名 Apex",
  "Write some Apex to run": "请输入要运行的 Apex 代码",
  "Run anonymous Apex": "运行匿名 Apex",
  "Run this anonymous Apex against {org}?": "在 {org} 中运行此匿名 Apex？",
  "the default org": "默认组织",
  "Compile failed": "编译失败",
  "Execution failed": "执行失败",
  "Debug levels": "调试级别",
  "Execution history": "执行历史",
  Result: "结果",
  "Run to see results": "运行以查看结果",
  Compiled: "已编译",
  Success: "成功",
  "Ln {line}:{column}": "第 {line} 行，第 {column} 列",
  "Copy exception": "复制异常",
  "Exception copied": "异常已复制",
  "Stack trace": "堆栈跟踪",
  "Debug log": "调试日志",
  "No debug log": "无调试日志",
  "Replace editor content": "替换编辑器内容",
  "Replace the current editor content?": "替换当前编辑器内容？",
  Replace: "替换",
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
  Copied: "已复制",
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
  "Select org": "选择组织",
  "No orgs": "暂无组织",
  "Org error": "组织错误",
  "Loading…": "正在加载…",
  "Where is this used?": "此字段用于何处？",
  "Refresh references": "刷新引用",
  "No references found.": "未找到引用。",
  "Couldn’t load references.": "无法加载引用。",
  "References: {error}": "引用：{error}",
  "Standard fields aren’t tracked by the Dependency API.": "Dependency API 不跟踪标准字段。",
  "Powered by the beta Dependency API — some report types, joined reports and private-folder reports are not detected.":
    "由测试版 Dependency API 提供支持，部分报表类型、联合报表及私有文件夹报表无法检测。",
  "just now": "刚刚",
  "{count} minute ago": "{count}分钟前",
  "{count} minutes ago": "{count}分钟前",
  "{count} hour ago": "{count}小时前",
  "{count} hours ago": "{count}小时前",
  "{count} day ago": "{count}天前",
  "{count} days ago": "{count}天前",
  "fetched {time}": "{time}获取",
  "Current org: {name}. Switch org": "当前组织：{name}。切换组织",
  "Select Salesforce org": "选择 Salesforce 组织",
  "Target org: {name}": "目标组织：{name}",
  Scratch: "临时组织",
  Sandbox: "沙盒",
  "Configure {name}": "配置 {name}",
  "Switch org": "切换组织",
  "Connect org…": "连接组织…",
  "API version must be a number like 58 or 58.0": "API 版本必须是 58 或 58.0 这样的数字",
  "Timeout must be a positive whole number of seconds": "超时时长必须为正整数秒",
  Color: "颜色",
  "No color": "无颜色",
  Slate: "石板灰",
  Red: "红色",
  Amber: "琥珀色",
  Green: "绿色",
  Teal: "青色",
  Blue: "蓝色",
  Violet: "紫色",
  Pink: "粉色",
  "{value} (default)": "{value}（默认）",
  "e.g. 58.0": "例如 58.0",
  "Edit {name}": "编辑 {name}",
  "Back to org list": "返回组织列表",
  "API version (optional)": "API 版本（可选）",
  "Timeout in seconds (optional)": "超时时长，单位秒（可选）",
  Save: "保存",
  Explain: "执行计划",
  Cancel: "取消",
  "Write a query to run": "请输入要运行的查询",
  "Run a query to see results": "运行查询以查看结果",
  "Checking size…": "正在检查结果规模…",
  "Executing…": "正在执行…",
  error: "错误",
  "{count} row returned": "已返回 {count} 行",
  "{count} rows returned": "已返回 {count} 行",
  "{fetched} of {total} rows · cancelled": "{total} 行中已获取 {fetched} 行 · 已取消",
  "Cancelled — showing {count} rows": "已取消，显示 {count} 行",
  "{milliseconds} ms": "{milliseconds} 毫秒",
  "<1s": "不足 1 秒",
  "{seconds}s": "{seconds}秒",
  "{minutes}m {seconds}s": "{minutes}分 {seconds}秒",
  "ETA {time}": "预计剩余 {time}",
  "Large result set": "大结果集",
  "This query has no": "此查询未设置",
  "and would return about": "，预计返回约",
  "rows — more than the {threshold} row guard. Fetching them all may be slow.":
    "行，超过 {threshold} 行保护阈值。获取全部记录可能较慢。",
  "Add LIMIT {count}": "添加 LIMIT {count}",
  "Run anyway": "仍然运行",
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

export function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return resolveLocale(navigator.languages.length ? navigator.languages : [navigator.language]);
}

function subscribe(callback: () => void) {
  window.addEventListener("languagechange", callback);
  return () => window.removeEventListener("languagechange", callback);
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, browserLocale, () => "en" as Locale);
  const t = useCallback(
    (key: MessageKey, values?: Readonly<Record<string, string | number>>) =>
      translate(locale, key, values),
    [locale],
  );
  return { locale, t };
}

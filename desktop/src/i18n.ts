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

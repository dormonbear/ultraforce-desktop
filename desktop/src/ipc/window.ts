import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Locale } from "../i18n";

let trayUpdate: Promise<unknown> = Promise.resolve();

/** Keep menu changes in locale order. / 按语言变化顺序更新菜单。 */
export function setTrayLocale(locale: Locale): Promise<unknown> {
  const next = trayUpdate.catch(() => {}).then(() => invoke("set_tray_locale", { locale }));
  trayUpdate = next;
  return next;
}

/** Fires when the window is brought back from the menu bar. */
export function onWindowShown(cb: () => void): Promise<() => void> {
  return listen("window-shown", cb);
}

/** Park the app in the menu bar instead of quitting. Resolves to `false` when
 * there is no tray icon to come back through — the caller must then close for
 * real, or the app would keep running with no way to reach it. */
export function hideToTray(): Promise<boolean> {
  return invoke<boolean>("hide_to_tray");
}

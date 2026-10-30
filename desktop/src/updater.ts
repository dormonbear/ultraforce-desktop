import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { browserLocale, translate, type MessageKey } from "./i18n";

function message(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  return translate(browserLocale(), key, values);
}

/** Download + install the update, then relaunch; surfaces progress via toasts. */
async function installUpdate(update: Update): Promise<void> {
  const t = toast.loading(message("Downloading update…"));
  try {
    await update.downloadAndInstall();
    toast.dismiss(t);
    await relaunch();
  } catch (e) {
    toast.dismiss(t);
    toast.error(message("Update failed: {error}", { error: String(e) }));
  }
}

// Check GitHub Releases for a newer version and, if found, offer a one-click
// download + restart. `verbose` adds "up to date" / error toasts for the manual
// Settings button; the silent startup check stays quiet when up to date/offline.
/** Prompt the user that an update is available, with a one-click install action. */
function offerUpdate(update: Update): void {
  toast(message("Update {version} available", { version: update.version }), {
    // Repeated checks for the same version should update one persistent offer. / 重复检查同一版本时复用一个持久提示。
    id: `update-available-${update.version}`,
    description: update.body || message("A new version is ready to install."),
    duration: Infinity,
    action: {
      label: message("Install & restart"),
      onClick: () => void installUpdate(update),
    },
  });
}

// fallow-ignore-next-line complexity
export async function checkForUpdates(verbose = false): Promise<void> {
  const checking = verbose ? toast.loading(message("Checking for updates…")) : null;
  const done = () => {
    if (checking) toast.dismiss(checking);
  };
  try {
    const update = await check();
    done();
    if (update) offerUpdate(update);
    else if (verbose) toast.success(message("You're up to date"));
  } catch (e) {
    // Network error / no release yet — stay silent on startup.
    done();
    if (verbose) toast.error(message("Update check failed: {error}", { error: String(e) }));
  }
}

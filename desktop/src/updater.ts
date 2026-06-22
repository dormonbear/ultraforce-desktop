import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

// Check GitHub Releases for a newer version and, if found, offer a one-click
// download + restart. Silent when up to date or offline. ponytail: no settings
// UI / no auto-install — a toast with an explicit action is enough.
export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    toast(`Update ${update.version} available`, {
      description: update.body || "A new version is ready to install.",
      duration: Infinity,
      action: {
        label: "Install & restart",
        onClick: async () => {
          const t = toast.loading("Downloading update…");
          try {
            await update.downloadAndInstall();
            toast.dismiss(t);
            await relaunch();
          } catch (e) {
            toast.dismiss(t);
            toast.error(`Update failed: ${e}`);
          }
        },
      },
    });
  } catch (e) {
    // Network error / no release yet — stay silent in the UI, just log.
    console.warn("update check failed:", e);
  }
}

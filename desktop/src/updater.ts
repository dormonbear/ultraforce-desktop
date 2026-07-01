import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

/** Download + install the update, then relaunch; surfaces progress via toasts. */
async function installUpdate(update: Update): Promise<void> {
  const t = toast.loading("Downloading update…");
  try {
    await update.downloadAndInstall();
    toast.dismiss(t);
    await relaunch();
  } catch (e) {
    toast.dismiss(t);
    toast.error(`Update failed: ${e}`);
  }
}

// Check GitHub Releases for a newer version and, if found, offer a one-click
// download + restart. `verbose` adds "up to date" / error toasts for the manual
// Settings button; the silent startup check stays quiet when up to date/offline.
/** Prompt the user that an update is available, with a one-click install action. */
function offerUpdate(update: Update): void {
  toast(`Update ${update.version} available`, {
    description: update.body || "A new version is ready to install.",
    duration: Infinity,
    action: {
      label: "Install & restart",
      onClick: () => void installUpdate(update),
    },
  });
}

// fallow-ignore-next-line complexity
export async function checkForUpdates(verbose = false): Promise<void> {
  const checking = verbose ? toast.loading("Checking for updates…") : null;
  const done = () => {
    if (checking) toast.dismiss(checking);
  };
  try {
    const update = await check();
    done();
    if (update) offerUpdate(update);
    else if (verbose) toast.success("You're up to date");
  } catch (e) {
    // Network error / no release yet — stay silent on startup, just log.
    done();
    if (verbose) toast.error(`Update check failed: ${e}`);
    console.warn("update check failed:", e);
  }
}

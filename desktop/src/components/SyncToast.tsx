import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { syncLabel, type SyncResult } from "./syncResult";

/** Listens for backend `sync-result` events. Logs silently — no toast. */
export function SyncToast() {
  useEffect(() => {
    const un = listen<SyncResult>("sync-result", (e) => {
      console.debug(syncLabel(e.payload));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);
  return null;
}

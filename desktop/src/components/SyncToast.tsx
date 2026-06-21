import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { syncLabel, type SyncResult } from "./syncResult";

/** Listens for backend `sync-result` events and shows a toast. Renders nothing. */
export function SyncToast() {
  useEffect(() => {
    const un = listen<SyncResult>("sync-result", (e) => {
      toast.success(syncLabel(e.payload));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);
  return null;
}

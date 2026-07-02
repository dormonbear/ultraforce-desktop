import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { formatIpcError } from "../errorFormat";
import { readLogFile } from "../ipc/logs";

/** Drag-and-drop a .log/.txt file onto the window to open it. Dropped paths
 * are arbitrary (outside the fs plugin's dialog-granted scope), so the body
 * is read via the `read_log_file` backend command, not `readTextFile`.
 * Returns whether a droppable file is currently over the window (overlay). */
export function useLogDragDrop(showLocalLog: (body: string) => Promise<void>) {
  // A .log/.txt file is being dragged over the window (drives the overlay).
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // fallow-ignore-next-line complexity
    const un = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "over") {
        setDragOver(true);
      } else if (payload.type === "leave") {
        setDragOver(false);
      } else if (payload.type === "drop") {
        setDragOver(false);
        const path = payload.paths.find((p) => /\.(log|txt)$/i.test(p));
        if (!path) {
          toast.error("Drop a .log or .txt file");
          return;
        }
        void (async () => {
          try {
            const body = await readLogFile(path);
            await showLocalLog(body);
          } catch (e) {
            toast.error(`Open failed: ${formatIpcError(e)}`);
          }
        })();
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [showLocalLog]);

  return dragOver;
}

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatIpcError } from "../errorFormat";

/** True when the drag carries OS files (not an in-app row drag). */
function isFileDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/** Drag-and-drop a .log/.txt file onto the window to open it. Uses HTML5 drop
 * events (the window's native `dragDropEnabled` is off so in-app HTML5 DnD —
 * e.g. the explorer tree — works); the body is read from the dropped `File`.
 * Returns whether a droppable file is currently over the window (overlay). */
export function useLogDragDrop(showLocalLog: (body: string) => Promise<void>) {
  // A file is being dragged over the window (drives the overlay).
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // dragenter/dragleave fire per element crossed; depth-count to keep the
    // overlay stable until the drag actually leaves the window.
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth += 1;
      setDragOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragOver(false);
      }
    };
    const onOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    // fallow-ignore-next-line complexity
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
        /\.(log|txt)$/i.test(f.name),
      );
      if (!file) {
        toast.error("Drop a .log or .txt file");
        return;
      }
      void (async () => {
        try {
          const body = await file.text();
          await showLocalLog(body);
        } catch (err) {
          toast.error(`Open failed: ${formatIpcError(err)}`);
        }
      })();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [showLocalLog]);

  return dragOver;
}

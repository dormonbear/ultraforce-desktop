import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

interface Progress {
  org: string;
  phase: string;
  done: number;
  total: number;
}

/** Top-bar indicator shown while an org is being indexed; hides when done. */
export function IndexProgress() {
  const [p, setP] = useState<Progress | null>(null);

  useEffect(() => {
    const un = listen<Progress>("index-progress", (e) => {
      setP(e.payload.phase === "done" ? null : e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  if (!p) return null;

  const label =
    p.phase === "sobjects"
      ? `Indexing objects ${p.done}/${p.total}`
      : p.phase === "classes"
        ? "Indexing Apex classes"
        : "Indexing stdlib";

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
      <Loader2 size={12} className="spin" />
      {label}
    </span>
  );
}

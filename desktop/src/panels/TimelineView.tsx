import { useEffect, useMemo, useRef, useState } from "react";
import type { UnitDto } from "../types";
import type { SourceRef } from "./sourceRef";
import { flameLayout, flameSpan, flameDepth, timeToX } from "./flame";
import { flameColor } from "./flameColor";

const ROW_H = 18;

export function TimelineView({
  units,
  onSource: _onSource,
}: {
  units: UnitDto[];
  onSource: (r: SourceRef) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rects = useMemo(() => flameLayout(units.flatMap((u) => u.tree)), [units]);
  const span = useMemo(() => flameSpan(rects), [rects]);
  const maxDepth = useMemo(() => flameDepth(rects), [rects]);

  // Viewport in ns; starts at the full span.
  const [view, setView] = useState<{ start: number; end: number }>(span);
  useEffect(() => setView(span), [span]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = (maxDepth + 1) * ROW_H;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "middle";

    for (const r of rects) {
      const x0 = timeToX(r.x, view.start, view.end, cssW);
      const x1 = timeToX(r.x + r.w, view.start, view.end, cssW);
      const w = Math.max(1, x1 - x0);
      if (x0 > cssW || x1 < 0 || w < 1) continue; // cull off-screen / sub-pixel
      const y = r.depth * ROW_H;
      ctx.fillStyle = flameColor(r.kind);
      ctx.fillRect(x0, y, w, ROW_H - 1);
      if (w > 30) {
        ctx.fillStyle = "#0b0f1a";
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, y, w - 4, ROW_H - 1);
        ctx.clip();
        ctx.fillText(r.label, x0 + 3, y + ROW_H / 2);
        ctx.restore();
      }
    }
  }, [rects, view, maxDepth]);

  if (rects.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No execution tree
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
        <canvas ref={canvasRef} className="block w-full" />
      </div>
    </div>
  );
}

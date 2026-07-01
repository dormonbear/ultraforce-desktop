import { useEffect, useMemo, useRef, useState } from "react";
import type { UnitDto } from "../types";
import type { SourceRef } from "./sourceRef";
import { flameLayout, flameSpan, flameDepth, timeToX, xToTime, minimapSkyline } from "./flame";
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

  const MINI_N = 120;
  const sky = useMemo(() => minimapSkyline(rects, span.start, span.end, MINI_N), [rects, span]);
  const skyMax = useMemo(() => Math.max(1, ...sky), [sky]);

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

  const drag = useRef<{ x: number; start: number; end: number } | null>(null);

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = xToTime(px, view.start, view.end, rect.width);
    const factor = e.deltaY < 0 ? 0.8 : 1.25; // in / out
    const newSpan = (view.end - view.start) * factor;
    const ratio = (t - view.start) / (view.end - view.start);
    let start = t - ratio * newSpan;
    let end = start + newSpan;
    // clamp to full span
    if (start < span.start) { start = span.start; end = start + newSpan; }
    if (end > span.end) { end = span.end; start = Math.max(span.start, end - newSpan); }
    setView({ start, end });
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.shiftKey) return; // reserved for measure (later task)
    drag.current = { x: e.clientX, start: view.start, end: view.end };
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = drag.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = ((e.clientX - d.x) / rect.width) * (d.end - d.start);
    let start = d.start - dt;
    let end = d.end - dt;
    if (start < span.start) { start = span.start; end = start + (d.end - d.start); }
    if (end > span.end) { end = span.end; start = end - (d.end - d.start); }
    setView({ start, end });
  }
  function onMouseUp() { drag.current = null; }

  if (rects.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No execution tree
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="relative mb-1.5 h-8 w-full cursor-pointer overflow-hidden rounded bg-border/40"
        onMouseDown={(e) => {
          const el = e.currentTarget;
          const r = el.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const t = span.start + frac * (span.end - span.start);
          const w = view.end - view.start;
          let start = t - w / 2;
          let end = start + w;
          if (start < span.start) { start = span.start; end = start + w; }
          if (end > span.end) { end = span.end; start = end - w; }
          setView({ start, end });
        }}
      >
        <div className="flex h-full w-full items-end">
          {sky.map((d, i) => (
            <span
              key={i}
              className="flex-1 bg-slate-500/60"
              style={{ height: `${(d / skyMax) * 100}%` }}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/10"
          style={{
            left: `${((view.start - span.start) / (span.end - span.start)) * 100}%`,
            width: `${((view.end - view.start) / (span.end - span.start)) * 100}%`,
          }}
        />
      </div>
      <div className="flex items-center gap-2 pb-1.5 text-[11px] text-text-dim">
        <button
          type="button"
          onClick={() => setView(span)}
          className="focus-accent cursor-pointer rounded px-1.5 py-0.5 hover:text-foreground"
        >
          Reset zoom
        </button>
        <span>scroll to zoom · drag to pan</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
        <canvas
          ref={canvasRef}
          className="block w-full"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
    </div>
  );
}

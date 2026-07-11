import { useEffect, useMemo, useRef, useState } from "react";
import type { UnitDto } from "../types";
import type { SourceRef } from "./sourceRef";
import {
  flameLayout,
  flameSpan,
  flameDepth,
  timeToX,
  xToTime,
  minimapSkyline,
  hitTest,
  timeAxisTicks,
  formatAxisTime,
  type FlameRect,
} from "./flame";
import { flameColor } from "./flameColor";

const ROW_H = 18;
const MAX_FLAME_H = 720;

function fmtDuration(ns: number | null | undefined): string {
  if (ns == null) return "—";
  return formatAxisTime(ns).replace(/^\+/, "");
}

// fallow-ignore-next-line complexity
export function TimelineView({
  units,
  onSource,
}: {
  units: UnitDto[];
  onSource?: (r: SourceRef) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rects = useMemo(() => flameLayout(units.flatMap((u) => u.tree)), [units]);
  const span = useMemo(() => flameSpan(rects), [rects]);
  const maxDepth = useMemo(() => flameDepth(rects), [rects]);
  const flameHeight = (maxDepth + 1) * ROW_H;
  const flameViewportHeight = Math.min(MAX_FLAME_H, flameHeight + 8);

  // Viewport in ns; starts at the full span.
  const [view, setView] = useState<{ start: number; end: number }>(span);
  useEffect(() => setView(span), [span]);

  const MINI_N = 120;
  const sky = useMemo(() => minimapSkyline(rects, span.start, span.end, MINI_N), [rects, span]);
  const skyMax = useMemo(() => Math.max(1, ...sky), [sky]);
  const ticks = useMemo(
    () => timeAxisTicks(view.start, view.end, span.start),
    [view, span.start],
  );

  // Track the canvas's displayed width so the bitmap is re-rendered at the right
  // resolution when the window/panel resizes. Without this the draw effect never
  // re-runs on resize and the browser stretches the old bitmap — scaling the bars
  // and the 11px labels up proportionally.
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<FlameRect | null>(null);
  // fallow-ignore-next-line complexity
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setWidth(canvas.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = width;
    if (cssW === 0) return;
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
      if (r === selected) {
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, Math.max(1, w - 1), ROW_H - 2);
      }
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
  }, [rects, view, maxDepth, width, selected]);

  const miniRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; end: number } | null>(null);
  const moved = useRef(false);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    rect: FlameRect;
  } | null>(null);
  const [measure, setMeasure] = useState<{ x0: number; x1: number } | null>(null);
  const measuring = useRef<number | null>(null);

  useEffect(() => {
    if (selected && !rects.includes(selected)) setSelected(null);
  }, [rects, selected]);

  // Native (non-passive) wheel listener: React 19 registers `onWheel` as a
  // passive root listener, so e.preventDefault() there is a no-op and the
  // overflow-auto container still scrolls while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function handler(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
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
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [view, span]);

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    moved.current = false;
    if (e.shiftKey) {
      const rect = canvasRef.current!.getBoundingClientRect();
      measuring.current = e.clientX - rect.left;
      setMeasure({ x0: measuring.current, x1: measuring.current });
      moved.current = true;
      setHover(null);
      return;
    }
    drag.current = { x: e.clientX, start: view.start, end: view.end };
  }
  // fallow-ignore-next-line complexity
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (measuring.current != null) {
      setMeasure({ x0: measuring.current, x1: e.clientX - rect.left });
      return;
    }
    const d = drag.current;
    if (!d) {
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const hit = hitTest(rects, px, py, view.start, view.end, rect.width, ROW_H);
      setHover(hit ? { x: px, y: py, clientX: e.clientX, clientY: e.clientY, rect: hit } : null);
      return;
    }
    moved.current = true;
    const dt = ((e.clientX - d.x) / rect.width) * (d.end - d.start);
    let start = d.start - dt;
    let end = d.end - dt;
    if (start < span.start) { start = span.start; end = start + (d.end - d.start); }
    if (end > span.end) { end = span.end; start = end - (d.end - d.start); }
    setView({ start, end });
  }
  function onMouseUp() {
    drag.current = null;
    measuring.current = null;
  }
  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (moved.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(rects, px, py, view.start, view.end, rect.width, ROW_H);
    setSelected(hit);
  }

  // Minimap wheel: zoom the viewport window in/out, centered on the cursor
  // time (mapped through the FULL span). Non-passive so preventDefault sticks.
  useEffect(() => {
    const mini = miniRef.current;
    if (!mini) return;
    function handler(e: WheelEvent) {
      e.preventDefault();
      const r = mini!.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const full = span.end - span.start;
      const t = span.start + frac * full;
      const factor = e.deltaY < 0 ? 0.8 : 1.25; // in / out
      const newSpan = Math.min(full, Math.max(full / 500, (view.end - view.start) * factor));
      let start = t - newSpan / 2;
      let end = start + newSpan;
      if (start < span.start) { start = span.start; end = start + newSpan; }
      if (end > span.end) { end = span.end; start = end - newSpan; }
      setView({ start, end });
    }
    mini.addEventListener("wheel", handler, { passive: false });
    return () => mini.removeEventListener("wheel", handler);
  }, [view, span]);

  // Minimap scrubbing: mousedown recenters the viewport on the cursor, and a
  // drag pans it left/right. Window listeners keep the drag alive even if the
  // cursor leaves the thin strip. Viewport width is fixed at grab time (pan, not
  // zoom), so span + w are captured once and there's no stale-view closure.
  function onMiniDown(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const w = view.end - view.start;
    const panTo = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const t = span.start + frac * (span.end - span.start);
      let start = t - w / 2;
      let end = start + w;
      if (start < span.start) { start = span.start; end = start + w; }
      if (end > span.end) { end = span.end; start = end - w; }
      setView({ start, end });
    };
    panTo(e.clientX);
    const onMove = (ev: MouseEvent) => panTo(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

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
        ref={miniRef}
        className="relative mb-1.5 h-8 w-full cursor-ew-resize overflow-hidden rounded bg-border/40"
        onMouseDown={onMiniDown}
        aria-label="Scroll to zoom · drag to pan"
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
        <span className="ml-auto font-mono">
          {formatAxisTime(view.start - span.start)} – {formatAxisTime(view.end - span.start)}
        </span>
      </div>
      <div className="relative h-5 shrink-0 rounded-t-md border border-b-0 border-border bg-card font-mono text-[10px] text-text-dim">
        {ticks.map((tick) => (
          <div
            key={`${tick.time}-${tick.pct}`}
            className="absolute inset-y-0 border-l border-border/80"
            style={{ left: `${tick.pct * 100}%` }}
          >
            <span
              className="absolute top-0.5 whitespace-nowrap"
              style={{
                transform:
                  tick.pct === 0
                    ? "translateX(3px)"
                    : tick.pct === 1
                      ? "translateX(calc(-100% - 3px))"
                      : "translateX(calc(-50% + 1px))",
              }}
            >
              {tick.label}
            </span>
          </div>
        ))}
      </div>
      {/* x stays hidden: the canvas is w-full (pan/zoom, never scrolls), but the
          absolute hover tooltip near the right edge would otherwise widen the
          scroll area and pop a useless horizontal scrollbar. */}
      <div
        className="relative shrink-0 overflow-y-auto overflow-x-hidden rounded-b-md border border-border bg-card"
        style={{ height: flameViewportHeight }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { onMouseUp(); setHover(null); }}
          onClick={onClick}
        />
        {hover && (
          <div
            className="pointer-events-none fixed z-50 max-w-xs rounded border border-border bg-popover px-2 py-1 text-[11px] shadow"
            style={{ left: hover.clientX + 12, top: hover.clientY + 12 }}
          >
            <div className="truncate font-medium text-foreground">{hover.rect.label}</div>
            <div className="text-text-dim">
              {hover.rect.kind} · {(hover.rect.w / 1_000_000).toFixed(3)} ms
            </div>
          </div>
        )}
        {measure && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-x border-amber-400 bg-amber-400/10"
              style={{ left: Math.min(measure.x0, measure.x1), width: Math.abs(measure.x1 - measure.x0) }}
            />
            <div
              className="pointer-events-none absolute top-1 z-10 rounded bg-amber-400 px-1 text-[10px] text-black"
              style={{ left: Math.min(measure.x0, measure.x1) }}
            >
              {(() => {
                const w = canvasRef.current?.clientWidth ?? 1;
                const dt = (Math.abs(measure.x1 - measure.x0) / w) * (view.end - view.start);
                return `${(dt / 1_000_000).toFixed(3)} ms`;
              })()}
            </div>
          </>
        )}
      </div>
      <div className="mt-2 shrink-0 rounded-md border border-border bg-card px-3 py-2 text-[12px]">
        {selected ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{selected.label}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-dim">
                <span>{selected.kind}</span>
                <span>start {formatAxisTime(selected.x - span.start)}</span>
                <span>end {formatAxisTime(selected.x + selected.w - span.start)}</span>
                <span>duration {fmtDuration(selected.w)}</span>
                <span>depth {selected.depth}</span>
              </div>
            </div>
            {selected.source && onSource && (
              <button
                type="button"
                onClick={() => onSource(selected.source as SourceRef)}
                className="focus-accent h-7 cursor-pointer rounded border border-border px-2 text-[11px] text-text-dim hover:border-primary hover:text-primary"
              >
                Open source
              </button>
            )}
          </div>
        ) : (
          <div className="text-text-dim">Select a flame block to inspect timing and source details.</div>
        )}
      </div>
    </div>
  );
}

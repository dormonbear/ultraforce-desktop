import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** ISO8601 value, or null/"" when unset. */
  value: string | null;
  onChange: (iso: string) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const p2 = (n: number) => String(n).padStart(2, "0");

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const fmt = (d: Date) =>
  `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()} ` +
  `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

/** Styled datetime picker: a custom month grid + a native time input, in a
 * Popover. Replaces the unstylable native `datetime-local` calendar. */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "—",
  invalid,
  className,
}: Props) {
  const selected = value ? new Date(value) : null;
  const valid = selected && !Number.isNaN(selected.getTime()) ? selected : null;
  const [view, setView] = useState(() => {
    const base = valid ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const emit = (d: Date) => onChange(d.toISOString());

  // Pick a day, keeping the current time-of-day (or 00:00:00 when unset).
  const pickDay = (day: Date) => {
    const base = valid ?? new Date(new Date().setHours(0, 0, 0, 0));
    emit(
      new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        base.getHours(),
        base.getMinutes(),
        base.getSeconds(),
      ),
    );
  };

  const setTime = (hhmmss: string) => {
    const [h, m, s] = hhmmss.split(":").map(Number);
    const base = valid ?? new Date();
    emit(
      new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        h || 0,
        m || 0,
        s || 0,
      ),
    );
  };

  const first = new Date(view.year, view.month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, i) =>
    new Date(view.year, view.month, 1 - startOffset + i),
  );
  const today = new Date();

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        className={cn(
          "focus-accent flex h-6 w-48 cursor-pointer items-center gap-1 rounded border border-border bg-card px-1.5 text-left text-[11px]",
          valid ? (invalid ? "text-destructive" : "text-foreground") : "text-text-dim",
          className,
        )}
      >
        <span className="truncate">{valid ? fmt(valid) : placeholder}</span>
        <CalendarDays size={12} className="ml-auto shrink-0 text-text-dim" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded-md border border-border bg-card p-2 text-[11px] shadow-md outline-none"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="focus-accent flex size-5 cursor-pointer items-center justify-center rounded text-text-dim hover:text-foreground"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-medium text-foreground">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="focus-accent flex size-5 cursor-pointer items-center justify-center rounded text-text-dim hover:text-foreground"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-0.5 text-center text-[10px] text-text-dim">
                {w}
              </div>
            ))}
            {cells.map((d) => {
              const inMonth = d.getMonth() === view.month;
              const isSel = valid && sameDay(d, valid);
              const isToday = sameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={cn(
                    "flex h-6 cursor-pointer items-center justify-center rounded",
                    isSel
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-foreground",
                    !isSel && (inMonth ? "text-foreground" : "text-text-dim/50"),
                    !isSel && isToday && "ring-1 ring-primary/50",
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
            <span className="text-text-dim">Time</span>
            <input
              type="time"
              step="1"
              aria-label="Time"
              value={valid ? `${p2(valid.getHours())}:${p2(valid.getMinutes())}:${p2(valid.getSeconds())}` : ""}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className="focus-accent ml-auto h-6 rounded border border-border bg-card px-1 text-[11px] text-foreground"
            />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

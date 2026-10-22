import { addDays, weekdayOf } from "@openturnly/core";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useClickOutside, useDropdownPosition } from "./combobox.tsx";
import { type DateRange, RangeCalendar } from "./range-calendar.tsx";

export type Period = { start: string; end: string };

/** "2026-10-21" → the Monday of that week. */
function weekStart(date: string) {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function monthEnd(month: string) {
  const [year = 0, number = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function previousMonth(date: string) {
  return addDays(`${date.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Common periods, all relative to `today` in the business's calendar. */
export function periodPresets(today: string) {
  const month = today.slice(0, 7);
  const lastMonth = previousMonth(today);
  return {
    today: { start: today, end: today },
    week: { start: weekStart(today), end: addDays(weekStart(today), 6) },
    month: { start: `${month}-01`, end: monthEnd(month) },
    lastMonth: { start: `${lastMonth}-01`, end: monthEnd(lastMonth) },
    next30: { start: today, end: addDays(today, 29) },
    last30: { start: addDays(today, -29), end: today },
    year: { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` },
  } satisfies Record<string, Period>;
}

export type PresetKey = keyof ReturnType<typeof periodPresets>;

/**
 * A button showing the chosen period that opens shortcuts ("Este mes", "Mes pasado"…) and
 * a calendar for any other range.
 */
export function DateRangePicker({
  value,
  onChange,
  today,
  locale,
  labels,
}: {
  value: Period;
  onChange: (period: Period) => void;
  today: string;
  locale: string;
  labels: Record<PresetKey, string> & { custom: string; previous: string; next: string };
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, 520);
  useClickOutside(open, [trigger, panel], () => setOpen(false));

  const presets = periodPresets(today);
  const active = (Object.keys(presets) as PresetKey[]).find(
    (key) => presets[key].start === value.start && presets[key].end === value.end,
  );
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const label =
    value.start === value.end
      ? format.format(new Date(`${value.start}T12:00:00Z`))
      : format.formatRange(
          new Date(`${value.start}T12:00:00Z`),
          new Date(`${value.end}T12:00:00Z`),
        );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setDraft(null);
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 shadow-xs hover:bg-zinc-50"
      >
        <CalendarDays className="size-4 text-zinc-400" aria-hidden />
        {active && <span className="text-zinc-500">{labels[active]} ·</span>}
        <span className="tabular-nums">{label}</span>
        <ChevronDown className="size-3.5 text-zinc-400" aria-hidden />
      </button>
      {open && (
        <div
          ref={panel}
          style={position}
          className="z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg sm:flex-row"
        >
          <div className="flex flex-wrap gap-1 border-b border-zinc-100 p-2 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
            {(Object.keys(presets) as PresetKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onChange(presets[key]);
                  setOpen(false);
                }}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  key === active
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-zinc-700 hover:bg-zinc-100",
                )}
              >
                {labels[key]}
              </button>
            ))}
          </div>
          <div className="p-3 sm:w-80">
            <p className="mb-2 text-xs font-medium text-zinc-500">{labels.custom}</p>
            <RangeCalendar
              value={draft ?? { start: value.start, end: value.end }}
              onChange={(range) => {
                setDraft(range);
                if (range.end) {
                  onChange({ start: range.start, end: range.end });
                  setOpen(false);
                }
              }}
              min="2000-01-01"
              locale={locale}
              labels={{ previous: labels.previous, next: labels.next }}
            />
          </div>
        </div>
      )}
    </>
  );
}

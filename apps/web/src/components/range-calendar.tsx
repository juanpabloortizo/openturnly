import { weekdayOf } from "@openturnly/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.ts";
import { datesOfMonth, shiftMonth } from "./month-calendar.tsx";
import { weekdayName } from "./weekly-hours.tsx";

export type DateRange = { start: string; end: string | null };

/**
 * Month grid (Monday first) to pick one day or a range: the first click sets the start,
 * the second the end. Dates are "YYYY-MM-DD" in the business's calendar. `marks` paints a
 * dot under days that already mean something (a closure, a holiday). `months` shows that many
 * months side by side.
 */
export function RangeCalendar({
  value,
  onChange,
  min,
  marks,
  locale,
  labels,
  months = 1,
}: {
  value: DateRange | null;
  onChange: (value: DateRange) => void;
  min: string;
  marks?: ReadonlyMap<string, "closed" | "holiday">;
  locale: string;
  labels: { previous: string; next: string };
  months?: number;
}) {
  const [month, setMonth] = useState((value?.start ?? min).slice(0, 7));
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = Array.from({ length: months }, (_, index) => shiftMonth(month, index));

  // While choosing the end, the hovered day previews the range.
  const start = value?.start ?? null;
  const end = value?.end ?? (start && hovered && hovered > start ? hovered : start);

  const pick = (date: string) => {
    if (!value || value.end !== null || date < value.start) onChange({ start: date, end: null });
    else onChange({ start: value.start, end: date });
  };

  const navigation = (
    <div className="flex gap-0.5">
      <button
        type="button"
        onClick={() => setMonth(shiftMonth(month, -1))}
        disabled={month <= min.slice(0, 7)}
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
        aria-label={labels.previous}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setMonth(shiftMonth(month, 1))}
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        aria-label={labels.next}
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className={cn("grid gap-x-8 gap-y-6", months > 1 && "sm:grid-cols-2")}>
      {shown.map((shownMonth, index) => {
        const dates = datesOfMonth(shownMonth);
        const leadingBlanks = ((dates[0] ? weekdayOf(dates[0]) : 1) + 6) % 7;
        const title = new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${shownMonth}-15T12:00:00Z`));
        return (
          // Phones show one month at a time, with the arrows on it.
          <div key={shownMonth} className={cn(index > 0 && "hidden sm:block")}>
            <div className="mb-2 flex h-7 items-center justify-between">
              <span className="pl-1 text-sm font-semibold text-zinc-900 first-letter:uppercase">
                {title}
              </span>
              {index === 0 && shown.length > 1 && <div className="sm:hidden">{navigation}</div>}
              {index === shown.length - 1 && (
                <div className={cn(shown.length > 1 && "hidden sm:block")}>{navigation}</div>
              )}
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: only clears the hover preview of the range. */}
            <div
              className="grid grid-cols-7 gap-y-1 text-center"
              onMouseLeave={() => setHovered(null)}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                <span key={weekday} className="pb-1 text-[11px] font-medium text-zinc-400">
                  {weekdayName(weekday, locale, "short").slice(0, 2)}
                </span>
              ))}
              {Array.from({ length: leadingBlanks }, (_, blank) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed empty cells before day 1.
                <span key={`blank-${blank}`} />
              ))}
              {dates.map((date) => {
                const past = date < min;
                const isEdge = date === start || date === end;
                const inside = start !== null && end !== null && date > start && date < end;
                const mark = marks?.get(date);
                return (
                  <div
                    key={date}
                    className={cn(
                      "relative",
                      inside && "bg-brand-50",
                      start !== end && date === start && "rounded-l-md bg-brand-50",
                      start !== end && date === end && "rounded-r-md bg-brand-50",
                    )}
                  >
                    <button
                      type="button"
                      disabled={past}
                      onClick={() => pick(date)}
                      onMouseEnter={() => setHovered(date)}
                      aria-pressed={isEdge || inside}
                      className={cn(
                        "relative mx-auto grid size-9 place-items-center rounded-md text-sm tabular-nums transition-colors",
                        isEdge
                          ? "bg-brand-600 font-semibold text-on-brand"
                          : inside
                            ? "font-medium text-brand-700"
                            : past
                              ? "text-zinc-300"
                              : "text-zinc-800 hover:bg-zinc-100",
                      )}
                    >
                      {Number(date.slice(8))}
                      {mark && !isEdge && (
                        <span
                          className={cn(
                            "absolute bottom-1 size-1 rounded-full",
                            mark === "closed" ? "bg-red-500" : "bg-amber-500",
                          )}
                        />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

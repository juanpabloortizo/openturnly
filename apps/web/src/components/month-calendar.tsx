import { addDays, weekdayOf } from "@openturnly/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { weekdayName } from "./weekly-hours.tsx";

/** "2026-10" → ["2026-10-01", …, "2026-10-31"] */
export function datesOfMonth(month: string): string[] {
  const dates: string[] = [];
  for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * Month grid (Monday first) where only dates with free times can be picked.
 * Dates are plain "YYYY-MM-DD" strings in the business's calendar.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  minMonth,
  maxMonth,
  available,
  selected,
  onSelect,
  loading,
  locale,
  labels,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  minMonth: string;
  maxMonth: string;
  available: ReadonlySet<string>;
  selected: string | null;
  onSelect: (date: string) => void;
  loading: boolean;
  locale: string;
  labels: { previous: string; next: string };
}) {
  const dates = datesOfMonth(month);
  const leadingBlanks = ((dates[0] ? weekdayOf(dates[0]) : 1) + 6) % 7;
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          disabled={month <= minMonth}
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
          aria-label={labels.previous}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <span className="text-sm font-semibold text-zinc-900 first-letter:uppercase">{title}</span>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          disabled={month >= maxMonth}
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
          aria-label={labels.next}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <span key={weekday} className="pb-1 text-xs font-medium text-zinc-400">
            {weekdayName(weekday, locale, "short").slice(0, 3)}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed empty cells before day 1.
          <span key={`blank-${index}`} />
        ))}
        {dates.map((date) => {
          const isAvailable = available.has(date);
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              disabled={!isAvailable}
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              className={cn(
                "relative grid aspect-square place-items-center rounded-lg text-sm transition-colors",
                isSelected
                  ? "bg-brand-600 font-semibold text-on-brand"
                  : isAvailable
                    ? "font-semibold text-zinc-900 hover:bg-brand-50"
                    : "text-zinc-300",
                loading && "animate-pulse",
              )}
            >
              {Number(date.slice(8))}
              {isAvailable && !isSelected && (
                <span className="absolute bottom-1.5 size-1 rounded-full bg-brand-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { parseTimeInput } from "@openturnly/core";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WeeklyRange } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { Toggle } from "./controls.tsx";

/** Monday first, the way most of Latin America and Europe read a week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function weekdayName(weekday: number, language: string, style: "long" | "short" = "long") {
  // 2023-01-01 was a Sunday.
  const date = new Date(Date.UTC(2023, 0, 1 + weekday));
  const name = new Intl.DateTimeFormat(language, { weekday: style, timeZone: "UTC" }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A time typed by hand, always shown as 24-hour HH:MM whatever the browser's locale. */
function TimeInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const parsed = parseTimeInput(draft);
    if (parsed) {
      setInvalid(false);
      setDraft(parsed);
      if (parsed !== value) onChange(parsed);
    } else {
      setInvalid(true);
      setDraft(value);
      setTimeout(() => setInvalid(false), 1200);
    }
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      inputMode="numeric"
      maxLength={5}
      placeholder="09:00"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="h-8 w-[68px] rounded-md border border-zinc-200 bg-white text-center text-sm text-zinc-900 tabular-nums shadow-xs transition-[border-color,box-shadow] focus-visible:border-brand-500 focus-visible:ring-3 focus-visible:ring-brand-500/15 focus-visible:outline-none aria-invalid:border-red-400 aria-invalid:ring-3 aria-invalid:ring-red-500/15"
    />
  );
}

function addHours(time: string, hours: number) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + hours * 60, 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function minutesOf(time: string) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes open in these ranges; ranges that end before they start count as nothing. */
export function openMinutes(ranges: readonly WeeklyRange[]) {
  return ranges.reduce(
    (total, range) => total + Math.max(0, minutesOf(range.end) - minutesOf(range.start)),
    0,
  );
}

/** 540 → "9 h", 270 → "4 h 30" */
export function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** Hours shown on the timeline: 6–22 at least, wider if some day starts earlier or ends later. */
function timelineWindow(value: readonly WeeklyRange[]) {
  let first = 6;
  let last = 22;
  for (const range of value) {
    first = Math.min(first, Math.floor(minutesOf(range.start) / 60));
    last = Math.max(last, Math.ceil(minutesOf(range.end) / 60));
  }
  return { first, last: Math.min(last, 24) };
}

/**
 * Opening hours, one row per day. A day can be closed or have several ranges (split
 * shifts like 9–13 and 15–19). With `timeline`, wide screens also draw each day on a
 * shared hour scale and show how many hours it is open.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  timeline = false,
}: {
  value: WeeklyRange[];
  onChange: (value: WeeklyRange[]) => void;
  timeline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { first, last } = timelineWindow(value);
  const span = (last - first) * 60;
  const ticks = Array.from({ length: Math.floor((last - first) / 2) + 1 }, (_, i) => first + i * 2);
  const position = (time: string) =>
    `${((Math.min(Math.max(minutesOf(time), first * 60), last * 60) - first * 60) / span) * 100}%`;

  const rangesOf = (weekday: number) =>
    value.filter((range) => range.weekday === weekday).sort((a, b) => (a.start < b.start ? -1 : 1));
  const replaceDay = (weekday: number, ranges: WeeklyRange[]) =>
    onChange([...value.filter((range) => range.weekday !== weekday), ...ranges]);

  const row = timeline
    ? "lg:grid lg:grid-cols-[9.5rem_15rem_minmax(0,1fr)_4.5rem] lg:items-center lg:gap-6"
    : "";

  return (
    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
      {timeline && (
        <div className={cn("hidden px-4 py-2 text-[11px] font-medium text-zinc-400", row)}>
          <span>{t("hours.colDay")}</span>
          <span>{t("hours.colHours")}</span>
          <div className="relative h-4">
            {ticks.map((hour) => (
              <span
                key={hour}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: position(`${String(hour).padStart(2, "0")}:00`) }}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          </div>
          <span className="text-right">{t("hours.colTotal")}</span>
        </div>
      )}
      {WEEK.map((weekday) => {
        const ranges = rangesOf(weekday);
        const open = ranges.length > 0;
        const dayName = weekdayName(weekday, language);
        return (
          <div
            key={weekday}
            className={cn(
              "flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-4",
              row,
            )}
          >
            <div className="flex h-8 w-36 shrink-0 items-center gap-3 lg:w-auto">
              <Toggle
                checked={open}
                label={dayName}
                onChange={(checked) =>
                  replaceDay(weekday, checked ? [{ weekday, start: "09:00", end: "18:00" }] : [])
                }
              />
              <span className={cn("text-sm font-medium", open ? "text-zinc-900" : "text-zinc-400")}>
                {dayName}
              </span>
            </div>
            {open ? (
              <div className="flex flex-col gap-1.5">
                {ranges.map((range, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no id; the index keeps focus while editing.
                  <div key={index} className="flex items-center gap-1.5">
                    <TimeInput
                      value={range.start}
                      label={`${dayName} · ${t("hours.opens")}`}
                      onChange={(start) =>
                        replaceDay(
                          weekday,
                          ranges.map((r, i) => (i === index ? { ...r, start } : r)),
                        )
                      }
                    />
                    <span className="text-zinc-400">–</span>
                    <TimeInput
                      value={range.end}
                      label={`${dayName} · ${t("hours.closes")}`}
                      onChange={(end) =>
                        replaceDay(
                          weekday,
                          ranges.map((r, i) => (i === index ? { ...r, end } : r)),
                        )
                      }
                    />
                    {index === 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const lastRange = ranges.at(-1);
                          const start = lastRange ? addHours(lastRange.end, 1) : "09:00";
                          replaceDay(weekday, [
                            ...ranges,
                            { weekday, start, end: addHours(start, 3) },
                          ]);
                        }}
                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-brand-700"
                        aria-label={t("hours.addRange")}
                        title={t("hours.addRange")}
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          replaceDay(
                            weekday,
                            ranges.filter((_, i) => i !== index),
                          )
                        }
                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                        aria-label={t("hours.removeRange")}
                        title={t("hours.removeRange")}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="flex h-8 items-center text-sm text-zinc-400">
                {t("hours.closed")}
              </span>
            )}
            {timeline && (
              <>
                <div
                  className="relative hidden h-8 self-start rounded-md bg-zinc-50 lg:block"
                  aria-hidden
                >
                  {ticks.map((hour) => (
                    <span
                      key={hour}
                      className="absolute inset-y-0 w-px bg-zinc-200/70"
                      style={{ left: position(`${String(hour).padStart(2, "0")}:00`) }}
                    />
                  ))}
                  {ranges.map((range) =>
                    range.end > range.start ? (
                      <span
                        key={`${range.start}-${range.end}`}
                        className="absolute inset-y-1.5 rounded bg-brand-500/85 transition-[left,right]"
                        style={{
                          left: position(range.start),
                          right: `calc(100% - ${position(range.end)})`,
                        }}
                        title={`${range.start}–${range.end}`}
                      />
                    ) : null,
                  )}
                </div>
                <span className="hidden h-8 items-center justify-end text-sm text-zinc-500 tabular-nums lg:flex">
                  {open ? formatHours(openMinutes(ranges)) : "—"}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

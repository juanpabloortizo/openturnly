import { useEffect, useState } from "react";
import { Select } from "./ui.tsx";

/** Days in a month: February of a leap year (or of no year yet) has 29. */
const daysIn = (year: string, month: string) =>
  new Date(Date.UTC(Number(year) || 2000, Number(month), 0)).getUTCDate();

const split = (value: string) => {
  const [year = "", month = "", day = ""] = value ? value.split("-") : [];
  return { year, month, day };
};

/**
 * A birth date as three lists, day, month and year, like every other list in the app:
 * quicker than paging a calendar back decades. Gives "YYYY-MM-DD" once all three are
 * chosen, and "" while one is missing.
 */
export function BirthDateField({
  id,
  value,
  onChange,
  locale,
  labels,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  locale: string;
  labels: { day: string; month: string; year: string };
  invalid?: boolean;
  describedBy?: string;
}) {
  const [parts, setParts] = useState(() => split(value));
  const composed =
    parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : "";

  // A date set from outside (a saved customer, a cleared form) replaces what's chosen.
  useEffect(() => {
    if (value !== composed && (value || composed)) setParts(split(value));
  }, [value, composed]);

  const update = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    // The 31st moved to a shorter month becomes its last day.
    if (next.day && next.month) {
      const last = daysIn(next.year, next.month);
      if (Number(next.day) > last) next.day = String(last).padStart(2, "0");
    }
    setParts(next);
    onChange(next.year && next.month && next.day ? `${next.year}-${next.month}-${next.day}` : "");
  };

  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const thisYear = new Date().getFullYear();
  const days = parts.month ? daysIn(parts.year, parts.month) : 31;
  const common = { "aria-invalid": invalid || undefined, "aria-describedby": describedBy };

  return (
    <div className="grid grid-cols-[minmax(0,5rem)_minmax(0,1fr)_minmax(0,6rem)] gap-2">
      <Select
        id={id}
        aria-label={labels.day}
        {...common}
        value={parts.day}
        onChange={(event) => update({ day: event.target.value })}
      >
        <option value="">{labels.day}</option>
        {Array.from({ length: days }, (_, index) => String(index + 1).padStart(2, "0")).map(
          (day) => (
            <option key={day} value={day}>
              {Number(day)}
            </option>
          ),
        )}
      </Select>
      <Select
        aria-label={labels.month}
        {...common}
        value={parts.month}
        onChange={(event) => update({ month: event.target.value })}
      >
        <option value="">{labels.month}</option>
        {Array.from({ length: 12 }, (_, index) => {
          const name = monthName.format(Date.UTC(2000, index, 15));
          const month = String(index + 1).padStart(2, "0");
          return (
            <option key={month} value={month}>
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </option>
          );
        })}
      </Select>
      <Select
        aria-label={labels.year}
        {...common}
        value={parts.year}
        onChange={(event) => update({ year: event.target.value })}
      >
        <option value="">{labels.year}</option>
        {Array.from({ length: thisYear - 1899 }, (_, index) => String(thisYear - index)).map(
          (year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ),
        )}
      </Select>
    </div>
  );
}

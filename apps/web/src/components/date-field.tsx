import { CalendarDays, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useClickOutside, useDropdownPosition } from "./combobox.tsx";
import { RangeCalendar } from "./range-calendar.tsx";

/** One date picked from a calendar, or none ("no limit"). */
export function DateField({
  id,
  value,
  onChange,
  placeholder,
  min = "2000-01-01",
  locale,
  labels,
  invalid,
}: {
  id?: string;
  value: string | null;
  onChange: (date: string | null) => void;
  placeholder: string;
  min?: string;
  locale: string;
  labels: { previous: string; next: string; clear: string };
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, 320);
  useClickOutside(open, [trigger, panel], () => setOpen(false));
  const label = value
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value}T12:00:00Z`))
    : placeholder;

  return (
    <div className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-white px-3 text-left text-sm shadow-xs hover:bg-zinc-50",
          invalid ? "border-red-400" : "border-zinc-300",
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-zinc-400" aria-hidden />
        <span className={cn("flex-1 truncate tabular-nums", !value && "text-zinc-400")}>
          {label}
        </span>
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={labels.clear}
          title={labels.clear}
          className="absolute inset-y-0 right-1.5 my-auto grid size-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <div
          ref={panel}
          style={position}
          className="z-50 w-80 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
        >
          <RangeCalendar
            value={value ? { start: value, end: value } : null}
            onChange={(range) => {
              onChange(range.start);
              setOpen(false);
            }}
            min={min}
            locale={locale}
            labels={{ previous: labels.previous, next: labels.next }}
          />
        </div>
      )}
    </div>
  );
}

import { dialCodeOf, phoneCountries, splitPhone } from "@openturnly/core";
import { ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { flag } from "../lib/locale.ts";
import { searchable, useClickOutside, useDropdownPosition } from "./combobox.tsx";

/**
 * Mobile number with a searchable country picker. The value is E.164 ("+573001234567"),
 * or "" while empty; the server normalizes and validates it again.
 */
export function PhoneInput({
  value,
  onChange,
  defaultCountry,
  locale,
  searchPlaceholder,
  id,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultCountry: string | null;
  locale: string;
  searchPlaceholder: string;
  id?: string;
  invalid?: boolean;
}) {
  const initial = splitPhone(value);
  const [country, setCountry] = useState(
    initial?.country ?? (defaultCountry && dialCodeOf(defaultCountry) ? defaultCountry : "US"),
  );
  const [national, setNational] = useState(initial?.national ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, ref, 288);

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return phoneCountries()
      .map((entry) => ({ ...entry, name: names.of(entry.code) ?? entry.code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);

  const visible = useMemo(() => {
    const needle = searchable(query.trim()).replace(/^\+/, "");
    if (!needle) return countries;
    return countries.filter(
      (entry) =>
        searchable(entry.name).includes(needle) ||
        entry.code.toLowerCase() === needle ||
        entry.dialCode.startsWith(needle),
    );
  }, [countries, query]);

  useClickOutside(open, [ref, panel], () => setOpen(false));

  const emit = (nextCountry: string, nextNational: string) => {
    const digits = nextNational.replace(/\D/g, "");
    onChange(digits ? `+${dialCodeOf(nextCountry)}${digits}` : "");
  };

  return (
    <div ref={ref} className="relative">
      <div
        className={cn(
          "flex h-9 rounded-md border bg-white shadow-xs transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15",
          invalid ? "border-red-400" : "border-zinc-200",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex shrink-0 items-center gap-1.5 rounded-l-md border-r border-zinc-200 bg-zinc-50 pr-2 pl-3 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          <span className="text-base leading-none">{flag(country)}</span>
          <span className="tabular-nums">+{dialCodeOf(country)}</span>
          <ChevronDown className="size-3.5 text-zinc-400" aria-hidden />
        </button>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d\s()-]/g, "");
            setNational(next);
            emit(country, next);
          }}
          className="min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-sm text-zinc-900 tabular-nums outline-none placeholder:text-zinc-400"
          placeholder="300 123 4567"
        />
      </div>

      {open && (
        <div
          ref={panel}
          style={position}
          className="z-50 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-zinc-100 p-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              // biome-ignore lint/a11y/noAutofocus: the picker just opened to search a country.
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-md border border-zinc-200 pr-2 pl-8 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {visible.map((entry) => (
              <li key={entry.code}>
                <button
                  type="button"
                  aria-pressed={entry.code === country}
                  onClick={() => {
                    setCountry(entry.code);
                    setOpen(false);
                    setQuery("");
                    emit(entry.code, national);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-zinc-50",
                    entry.code === country && "bg-brand-50 text-brand-700",
                  )}
                >
                  <span className="text-base leading-none">{flag(entry.code)}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <span className="text-zinc-400 tabular-nums">+{entry.dialCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

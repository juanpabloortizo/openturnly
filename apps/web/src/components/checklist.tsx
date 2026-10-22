import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchable } from "./combobox.tsx";

export type ChecklistItem = { id: string; label: string; detail?: ReactNode };

/** From this many items on, the list offers a search box. */
const SEARCH_FROM = 7;

/**
 * Picks several items from a list: checkboxes in a box that scrolls after a dozen rows, how
 * many are chosen, shortcuts to choose all or none and, for long lists, a search. The
 * shortcuts act on what the search shows. `value` keeps the items' own order.
 */
export function Checklist({
  items,
  value,
  onChange,
  label,
}: {
  items: ChecklistItem[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** What the list is, for screen readers. */
  label: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const words = searchable(query.trim());
    return words ? items.filter((item) => searchable(item.label).includes(words)) : items;
  }, [items, query]);
  const chosen = new Set(value);
  const set = (ids: string[], on: boolean) => {
    const next = new Set(value);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(items.filter((item) => next.has(item.id)).map((item) => item.id));
  };

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {items.length >= SEARCH_FROM && (
        <div className="relative border-b border-zinc-100 p-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Enter only searches: it mustn't submit the form the list sits in.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder={t("checklist.search")}
            aria-label={t("checklist.search")}
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pr-2 pl-8 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-500"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/70 px-3 py-1.5 text-[13px]">
        <span className="text-zinc-500">
          {t("checklist.chosen", { count: value.length, total: items.length })}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              set(
                shown.map((item) => item.id),
                true,
              )
            }
            className="rounded px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50"
          >
            {t("checklist.all")}
          </button>
          <span className="text-zinc-300" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={() =>
              set(
                shown.map((item) => item.id),
                false,
              )
            }
            className="rounded px-1.5 py-0.5 font-medium text-zinc-600 hover:bg-zinc-100"
          >
            {t("checklist.none")}
          </button>
        </div>
      </div>
      <ul aria-label={label} className="max-h-72 divide-y divide-zinc-100 overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-zinc-50">
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded border-zinc-300 accent-brand-600"
                checked={chosen.has(item.id)}
                onChange={(event) => set([item.id], event.target.checked)}
              />
              <span className="min-w-0 flex-1 text-sm text-zinc-800">{item.label}</span>
              {item.detail && (
                <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{item.detail}</span>
              )}
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-zinc-500">{t("checklist.empty")}</li>
        )}
      </ul>
    </div>
  );
}

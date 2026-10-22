import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";
import { Button, Input } from "./ui.tsx";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Applied to both the header and the cells, e.g. "hidden md:table-cell" or "text-right". */
  className?: string;
  /**
   * Shown on phones, where each row is a card. By default, columns hidden on small screens
   * ("hidden …") are left out there too.
   */
  phone?: boolean;
};

const onPhone = <T,>(column: Column<T>) =>
  column.phone ?? !column.className?.split(/\s+/).includes("hidden");

/**
 * Table with optional search and client-side pagination. Lists in OpenTurnly are small
 * (a business has tens of services, not thousands), so everything is filtered in memory.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  searchPlaceholder,
  matches,
  toolbar,
  empty,
  pageSize = 10,
  flush,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Shows a search box; `matches` decides whether a row fits the lowercased query. */
  searchPlaceholder?: string;
  matches?: (row: T, query: string) => boolean;
  toolbar?: ReactNode;
  empty: ReactNode;
  pageSize?: number;
  /** Inside a card: no border or rounded corners of its own. */
  flush?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized || !matches) return rows;
    return rows.filter((row) => matches(row, normalized));
  }, [rows, query, matches]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);
  const from = filtered.length === 0 ? 0 : current * pageSize + 1;
  const to = current * pageSize + visible.length;

  return (
    <div className={cn("overflow-hidden bg-white", !flush && "rounded-lg border border-zinc-200")}>
      {(searchPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          {searchPlaceholder ? (
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 pl-8"
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-zinc-500">
          {rows.length === 0 ? empty : t("table.noResults")}
        </div>
      ) : (
        <>
          <PhoneRows
            columns={columns.filter(onPhone)}
            rows={visible}
            rowKey={rowKey}
            onRowClick={onRowClick}
          />
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50/80">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        "px-4 py-2.5 text-xs font-medium tracking-wide text-zinc-500 uppercase",
                        column.className,
                      )}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer hover:bg-zinc-50/80")}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn("px-4 py-3 align-middle", column.className)}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-[13px] text-zinc-500">
          <span>{t("table.showing", { from, to, total: filtered.length })}</span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
              >
                <ChevronLeft className="size-4" aria-hidden />
                {t("table.previous")}
              </Button>
              <span className="px-2 tabular-nums">
                {current + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount - 1}
              >
                {t("table.next")}
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The rows on a phone, as cards: the first column on top with the actions (columns without
 * a header) beside it, and the rest below, each with its header as a label.
 */
function PhoneRows<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  const [lead, ...rest] = columns;
  const actions = rest.filter((column) => !column.header);
  const details = rest.filter((column) => column.header);
  if (!lead) return null;
  return (
    <ul className="divide-y divide-zinc-100 sm:hidden">
      {rows.map((row) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: like the table's rows; each opens with its own button or link too.
        <li
          key={rowKey(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={cn("px-4 py-3", onRowClick && "cursor-pointer active:bg-zinc-50")}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 text-sm">{lead.cell(row)}</div>
            {actions.map((column) => (
              <div key={column.key} className="shrink-0">
                {column.cell(row)}
              </div>
            ))}
          </div>
          {details.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {details.map((column) => (
                <div key={column.key} className="min-w-0 max-w-full">
                  <dt className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    {column.header}
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-zinc-700">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The leading cell of a row: an initial (or icon) plus a title and a muted second line. */
export function IdentityCell({
  initial,
  imageUrl,
  title,
  subtitle,
}: {
  initial: string;
  /** A picture (a business's logo) instead of the initial. */
  imageUrl?: string | null;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="size-8 shrink-0 rounded-md bg-white object-cover ring-1 ring-zinc-200"
        />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-[13px] font-semibold text-zinc-700">
          {initial.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-zinc-900">{title}</div>
        {subtitle && <div className="truncate text-[13px] text-zinc-500">{subtitle}</div>}
      </div>
    </div>
  );
}

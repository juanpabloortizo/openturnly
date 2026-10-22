import {
  ALL_AUTOMATION_FIELDS,
  AUTOMATION_FIELDS,
  AUTOMATION_GROUPS,
  type AutomationGroup,
  valueAt,
} from "@openturnly/core";
import {
  ArrowLeft,
  Braces,
  Building2,
  CalendarDays,
  ChevronRight,
  type LucideIcon,
  Search,
  UserRound,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../../components/combobox.tsx";
import { cn } from "../../lib/cn.ts";

const GROUP_ICONS: Record<AutomationGroup, LucideIcon> = {
  appointment: CalendarDays,
  customer: UserRound,
  business: Building2,
};

type Item = { path: string; label: string; group: AutomationGroup; example: string };
type Row = { group: AutomationGroup; item?: Item };

/** Text to search by: lower case, without accents. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** How an example value reads next to its name. */
function example(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? "{…}" : String(value);
}

/**
 * "Insert data": the appointment's data by group (appointment, customer, business). Opening
 * a group lists its values with an example of each; the search looks through all of them.
 * Picking one hands back its path ("customer.first_name"). With `objects`, each group also
 * offers itself whole, for JSON bodies.
 */
export function DataPicker({
  sample,
  objects = false,
  onPick,
}: {
  sample: Record<string, unknown>;
  objects?: boolean;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<AutomationGroup | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const refs = useMemo(() => [root], []);
  const close = useCallback(() => {
    setOpen(false);
    setGroup(null);
    setQuery("");
    setActive(0);
  }, []);
  useClickOutside(open, refs, close);

  const items = useMemo(
    () =>
      AUTOMATION_GROUPS.flatMap((g): Item[] => [
        ...(objects
          ? [{ path: g, label: t("automations.data.whole"), group: g, example: "{…}" }]
          : []),
        ...AUTOMATION_FIELDS[g].map((path) => ({
          path,
          label: t(`automations.fields.${path}`),
          group: g,
          example: example(valueAt(sample, path)),
        })),
      ]),
    [objects, sample, t],
  );
  // The groups, until one is opened or something is searched.
  const rows = useMemo((): Row[] => {
    const words = fold(query.trim());
    if (!group && !words) return AUTOMATION_GROUPS.map((g) => ({ group: g }));
    return items
      .filter(
        (item) =>
          (!group || item.group === group) &&
          (!words || fold(`${item.label} ${item.path}`).includes(words)),
      )
      .map((item) => ({ group: item.group, item }));
  }, [group, items, query]);

  const openGroup = (next: AutomationGroup | null) => {
    setGroup(next);
    setQuery("");
    setActive(0);
    search.current?.focus();
  };
  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (!row.item) return openGroup(row.group);
    onPick(row.item.path);
    close();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 shadow-xs transition-colors hover:border-brand-300 hover:text-brand-700"
      >
        <Braces className="size-3.5" aria-hidden />
        {t("automations.data.insert")}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-76 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {group && (
            <div className="flex items-center gap-1 border-b border-zinc-100 px-1.5 py-1.5 text-[13px]">
              <button
                type="button"
                aria-label={t("common.back")}
                onClick={() => openGroup(null)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
              <span className="text-zinc-500">{t("automations.data.title")}</span>
              <ChevronRight className="size-3.5 text-zinc-400" aria-hidden />
              <span className="font-semibold text-zinc-900">
                {t(`automations.groups.${group}`)}
              </span>
            </div>
          )}
          <div className="relative border-b border-zinc-100 p-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              ref={search}
              // biome-ignore lint/a11y/noAutofocus: the list just opened to be searched.
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, rows.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(rows[active]);
                } else if (event.key === "Backspace" && !query && group) {
                  openGroup(null);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              placeholder={t("automations.data.search")}
              aria-label={t("automations.data.search")}
              aria-controls={listId}
              aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
              className="h-8 w-full rounded-md border border-zinc-200 bg-white pr-2 pl-8 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-500"
            />
          </div>
          <div id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {rows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">
                {t("automations.data.none")}
              </p>
            )}
            {rows.map((row, index) => {
              const Icon = GROUP_ICONS[row.group];
              return (
                <div
                  key={row.item?.path ?? row.group}
                  id={`${listId}-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  title={row.item ? `{{${row.item.path}}}` : undefined}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row)}
                  // Keys are handled by the search box, which keeps the focus.
                  onKeyDown={() => {}}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 text-sm text-zinc-800",
                    row.item ? "py-1.5" : "py-2",
                    index === active && "bg-zinc-100",
                  )}
                >
                  {row.item ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {row.item.label}
                        {!group && (
                          <span className="ml-1.5 text-xs text-zinc-400">
                            {t(`automations.groups.${row.group}`)}
                          </span>
                        )}
                      </span>
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-zinc-400">
                        {row.item.example}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex-1 font-medium">
                        {t(`automations.groups.${row.group}`)}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {AUTOMATION_FIELDS[row.group].length}
                      </span>
                      <ChevronRight className="size-4 text-zinc-400" aria-hidden />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Data that goes into a JSON body as its own value rather than as text. */
export const RAW_DATA: readonly string[] = [
  "appointment.duration_minutes",
  "appointment.price",
  "appointment.answers",
  ...AUTOMATION_GROUPS,
];

/**
 * Adds data to a JSON object as one more property, named after its path:
 * "customer_phone_digits": "{{customer.phone_digits}}".
 */
export function addToJson(json: string, path: string) {
  const close = json.lastIndexOf("}");
  if (close < 0) return `${json}{{${path}}}`;
  const before = json.slice(0, close).trimEnd();
  const value = RAW_DATA.includes(path) ? `{{${path}}}` : `"{{${path}}}"`;
  const comma = before.endsWith("{") ? "" : ",";
  return `${before}${comma}\n  "${path.replaceAll(".", "_")}": ${value}\n${json.slice(close)}`;
}

/**
 * A text box with "Insert data" on top, which puts {{path}} where the cursor was. Before the
 * box was ever used, the data goes at the end, or wherever `place` puts it.
 */
export function TemplateEditor({
  value,
  onChange,
  sample,
  objects,
  place,
  code = false,
  invalid = false,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  sample: Record<string, unknown>;
  objects?: boolean;
  place?: (value: string, path: string) => string;
  /** Monospaced, for JSON. */
  code?: boolean;
  invalid?: boolean;
} & Omit<ComponentProps<"textarea">, "value" | "onChange">) {
  const box = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<{ start: number; end: number } | null>(null);
  const insert = (path: string) => {
    const token = `{{${path}}}`;
    let next = `${value}${token}`;
    if (cursor.current) {
      const { start, end } = cursor.current;
      next = value.slice(0, start) + token + value.slice(end);
    } else if (place) {
      next = place(value, path);
    }
    onChange(next);
    const after = cursor.current
      ? cursor.current.start + token.length
      : next.lastIndexOf(token) + token.length;
    cursor.current = { start: after, end: after };
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(after, after);
    });
  };
  // The text is drawn by a copy underneath, with the placeholders marked; the box on top
  // only shows the caret and the selection. Both share the exact same text layout.
  const mirror = useRef<HTMLDivElement>(null);
  const layout = cn(
    "px-3 py-2 text-sm whitespace-pre-wrap break-words [scrollbar-gutter:stable]",
    code ? "font-mono text-[12px] leading-relaxed" : "font-sans",
  );
  return (
    <div
      className={cn(
        "rounded-md border bg-white shadow-xs transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15",
        invalid ? "border-red-400" : "border-zinc-200",
      )}
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 px-2 py-1.5">
        <DataPicker sample={sample} objects={objects} onPick={insert} />
      </div>
      <div className="relative">
        <div
          ref={mirror}
          aria-hidden
          className={cn(
            layout,
            "pointer-events-none absolute inset-0 overflow-hidden text-zinc-900",
          )}
        >
          {markPlaceholders(value, objects)}
          {/* Keeps a last empty line as tall as in the box. */}
          {"​"}
        </div>
        <textarea
          ref={box}
          spellCheck={!code}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onBlur={(event) => {
            cursor.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          className={cn(
            layout,
            "relative block w-full resize-y rounded-b-md bg-transparent text-transparent caret-zinc-900 outline-none selection:bg-brand-500/25 selection:text-transparent placeholder:text-zinc-400",
          )}
          {...props}
        />
      </div>
    </div>
  );
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_.]+)\s*\}\}/g;
const FIELDS = new Set<string>(ALL_AUTOMATION_FIELDS);
const GROUPS = new Set<string>(AUTOMATION_GROUPS);

/**
 * The text with each {{placeholder}} marked: tinted when it's real data, red when it isn't
 * (a typo, or a whole group where only text fits). Only colors change, never the size, so the
 * marked text lines up with the box above it.
 */
function markPlaceholders(text: string, objects = false) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    const known = FIELDS.has(name) || (objects && GROUPS.has(name));
    parts.push(
      text.slice(last, match.index),
      <mark
        key={match.index}
        className={cn(
          "rounded-[3px]",
          known
            ? "bg-brand-100 text-brand-800 shadow-[0_0_0_1.5px_var(--color-brand-100)]"
            : "bg-red-100 text-red-700 shadow-[0_0_0_1.5px_var(--color-red-100)]",
        )}
      >
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

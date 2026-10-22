import { Check, ChevronDown, Search } from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.ts";

/** Lowercase without accents, so "bogota" finds "Bogotá". */
export function searchable(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Where to draw a dropdown under (or above) its trigger. Fixed positioning keeps it out
 * of any card that clips its content (`overflow: hidden`).
 */
export function useDropdownPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  minWidth = 0,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, minWidth);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom;
      setStyle(
        below < 320 && rect.top > below
          ? { position: "fixed", left, width, bottom: window.innerHeight - rect.top + 4 }
          : { position: "fixed", left, width, top: rect.bottom + 4 },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, minWidth]);
  return style;
}

/** Closes a popup when the person clicks anywhere outside `refs`. */
/**
 * Keeps a menu that opens under its trigger on screen: lined up with the trigger's left or
 * right edge (`prefer`) when it fits, else moved just enough. Returns the menu's `left`,
 * relative to the trigger's wrapper.
 */
export function useMenuPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  width: number,
  prefer: "left" | "right" = "left",
): CSSProperties | undefined {
  const [left, setLeft] = useState<number>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured when it opens.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!open || !box) return;
    const fits = Math.min(width, window.innerWidth - 16);
    const wanted = prefer === "right" ? box.right - fits : box.left;
    setLeft(Math.max(8, Math.min(wanted, window.innerWidth - 8 - fits)) - box.left);
  }, [open]);
  return left === undefined ? undefined : { left, right: "auto" };
}

export function useClickOutside(
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!refs.some((ref) => ref.current?.contains(event.target as Node))) onOutside();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, refs, onOutside]);
}

export type ComboboxOption = {
  value: string;
  label: string;
  /** Muted text after the label: a country, an offset… */
  detail?: string;
  /** Extra words that should find this option. */
  keywords?: string;
};

/**
 * A select with a search box, for long lists (time zones, currencies). Type to filter,
 * arrows to move, Enter to pick, Escape to close.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  searchPlaceholder,
  emptyText,
  placeholder,
  disabled,
  stacked,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  searchPlaceholder: string;
  emptyText: string;
  /** Shown while nothing is picked. */
  placeholder?: string;
  disabled?: boolean;
  /** Each option on two lines, the detail under the label: for long labels on phones. */
  stacked?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const position = useDropdownPosition(open, trigger, 288);
  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const needle = searchable(query.trim());
    if (!needle) return options;
    return options.filter((option) =>
      searchable(`${option.label} ${option.detail ?? ""} ${option.keywords ?? ""}`).includes(
        needle,
      ),
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useClickOutside(open, [trigger, panel], close);

  // Start on the current value, and keep the highlighted option in view.
  useEffect(() => {
    if (open)
      setActive(
        Math.max(
          0,
          visible.findIndex((option) => option.value === value),
        ),
      );
  }, [open, visible, value]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (option: ComboboxOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
    trigger.current?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-zinc-200 bg-white pr-2.5 pl-3 text-left text-sm shadow-xs transition-[border-color,box-shadow] focus-visible:border-brand-500 focus-visible:ring-3 focus-visible:ring-brand-500/15 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-zinc-50 aria-invalid:border-red-400"
      >
        <span className="min-w-0 flex-1 truncate text-zinc-900">
          {selected?.label ?? (value || <span className="text-zinc-400">{placeholder}</span>)}
          {selected?.detail && <span className="ml-2 text-zinc-400">{selected.detail}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
      </button>
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
                  setActive((index) => Math.min(index + 1, visible.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  pick(visible[active]);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                  trigger.current?.focus();
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
              className="h-8 w-full rounded-md border border-zinc-200 pr-2 pl-8 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <div ref={list} id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">{emptyText}</p>
            )}
            {visible.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                // Keys are handled by the search box, which keeps the focus.
                onKeyDown={() => {}}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 text-sm",
                  stacked ? "py-2" : "py-1.5",
                  index === active && "bg-zinc-100",
                  option.value === value ? "text-brand-700" : "text-zinc-800",
                )}
              >
                {stacked ? (
                  <span className="min-w-0 flex-1">
                    <span className="block">{option.label}</span>
                    {option.detail && (
                      <span className="block text-xs text-zinc-400">{option.detail}</span>
                    )}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                    {option.detail && <span className="ml-2 text-zinc-400">{option.detail}</span>}
                  </span>
                )}
                {option.value === value && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

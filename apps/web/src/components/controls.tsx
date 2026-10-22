import { Eye, EyeOff, X } from "lucide-react";
import {
  type InputHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";
import { Button, Input } from "./ui.tsx";

/** Password input with a button to show or hide what was typed. */
export function PasswordInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", className)} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md text-zinc-400 outline-none hover:text-zinc-700 focus-visible:bg-zinc-100 focus-visible:text-zinc-700 focus-visible:ring-2 focus-visible:ring-brand-500/40"
        aria-label={visible ? t("common.hidePassword") : t("common.showPassword")}
        aria-pressed={visible}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/** The on/off control alone, for tables and compact rows. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Read by screen readers. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-zinc-200",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

/** On/off switch with a label and an optional description. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        {description && <p className="mt-0.5 text-[13px] text-zinc-500">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/**
 * Modal dialog on top of the page. Uses the native <dialog> element, which handles
 * Escape, focus and the backdrop.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** true for two-column forms; "xl" for editors with a side panel. */
  wide?: boolean | "xl";
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the close button; start on the first field instead, except on touch
      // screens, where that would pop the keyboard up over what the dialog shows.
      if (window.matchMedia("(pointer: fine)").matches) {
        dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
      }
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking the backdrop closes; Escape is handled by <dialog>.
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-black/40",
        wide === "xl" ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-3.5">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1.5 rounded-md p-1 text-zinc-400 outline-none hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              aria-label={t("common.close")}
            >
              <X className="size-[18px]" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            // On phones the buttons share the width, instead of wrapping unevenly.
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 max-sm:*:flex-1 max-sm:*:empty:hidden">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A settings block: title, explanation and controls in a card, with an optional action next
 * to the title, content attached edge to edge below (a table) and a footer bar.
 */
export function SettingsCard({
  title,
  description,
  action,
  children,
  attached,
  footer,
  footerNote,
  tone,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  attached?: ReactNode;
  footer?: ReactNode;
  footerNote?: ReactNode;
  tone?: "danger";
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-white",
        tone === "danger" ? "border-red-200" : "border-zinc-200",
      )}
    >
      <div className="flex-1 space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
      {attached && <div className="border-t border-zinc-200">{attached}</div>}
      {footer && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3",
            tone === "danger" ? "border-red-100 bg-red-50/50" : "border-zinc-200 bg-zinc-50/80",
          )}
        >
          <div className="text-[13px] text-zinc-500">{footerNote}</div>
          <div className="flex items-center gap-2">{footer}</div>
        </div>
      )}
    </section>
  );
}

/**
 * One save for a whole settings tab: it shows up at the bottom only while there are changes,
 * instead of a "Save" button on every card.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  if (!dirty && !saving) return null;
  return (
    <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
      <p className="text-sm text-zinc-700">{t("common.unsaved")}</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          {t("common.discard")}
        </Button>
        <Button onClick={onSave} loading={saving}>
          {t("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Tabs inside a page, kept in the URL (?tab=…) so a link can open a given tab.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  tour,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Where a guided tour points at the tabs. */
  tour?: string;
}) {
  // On a phone the tabs may not fit: they scroll sideways, with the edge that hides more
  // tabs fading out, and the open one always in view.
  const row = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const element = row.current;
    if (!element) return;
    const left = element.scrollLeft > 2;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
    setHidden((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  }, []);
  const reveal = useCallback(() => {
    const element = row.current;
    const active = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (element && active) {
      // Clear of the faded edges, so the open tab reads in full.
      const start = active.offsetLeft - element.offsetLeft;
      const end = start + active.offsetWidth;
      if (start - 32 < element.scrollLeft) element.scrollLeft = start - 32;
      else if (end + 32 > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = end + 32 - element.clientWidth;
      }
    }
    measure();
  }, [measure]);
  // Again when the tabs change size: the font loading, the window turning.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const observer = new ResizeObserver(reveal);
    for (const tab of element.children) observer.observe(tab);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reveal]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when another tab opens.
  useEffect(reveal, [value]);
  const fade = `linear-gradient(to right, ${hidden.left ? "transparent, black 32px" : "black"}, ${
    hidden.right ? "black calc(100% - 32px), transparent" : "black"
  })`;

  return (
    <div className="-mt-2 mb-6 border-b border-zinc-200" data-tour={tour}>
      <div
        ref={row}
        onScroll={measure}
        style={{ maskImage: fade }}
        className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] max-sm:gap-5 [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === value}
            onClick={() => onChange(tab.value)}
            className={cn(
              "border-b-2 pb-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:text-zinc-900",
              tab.value === value
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-14 text-center">
      <div className="mx-auto grid size-10 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
        {icon}
      </div>
      <h2 className="mt-4 text-sm font-semibold text-zinc-900">{title}</h2>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

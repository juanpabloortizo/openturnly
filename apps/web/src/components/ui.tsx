import { Check, ChevronDown, Copy, LoaderCircle } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  loading?: boolean;
};

const buttonVariants = {
  primary: "bg-brand-600 text-on-brand shadow-xs hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary:
    "border border-zinc-200 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50 disabled:text-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:text-zinc-300",
  danger: "bg-red-600 text-white shadow-xs hover:bg-red-700 disabled:bg-red-600/40",
};

const buttonSizes = {
  sm: "h-8 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
  icon: "size-8",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed",
    buttonSizes[size],
    buttonVariants[variant],
    className,
  );
}

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const controlClass =
  "block w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs transition-[border-color,box-shadow] placeholder:text-zinc-400 focus-visible:border-brand-500 focus-visible:ring-3 focus-visible:ring-brand-500/15 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 aria-invalid:border-red-400 aria-invalid:ring-red-500/15";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-20 py-2", className)} {...props} />;
}

/** Native select with the same look in every browser. `className` sizes the wrapper. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(controlClass, "h-9 appearance-none pr-9")} {...props} />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
    </div>
  );
}

/** Label + control + hint/error, wired together for screen readers. */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const describedBy = error || hint ? `${id}-description` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
        {optional && (
          <span className="ml-1.5 text-xs font-normal text-zinc-400">{t("common.optional")}</span>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {(error || hint) && (
        <p
          id={describedBy}
          className={cn("text-[13px]", error ? "text-red-600" : "text-zinc-500")}
          role={error ? "alert" : undefined}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-lg border border-zinc-200 bg-white", className)} {...props}>
      {children}
    </section>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-brand-100 bg-brand-50 text-brand-700",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3.5 py-2.5 text-sm", tones[tone])}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex items-center justify-center p-10 text-zinc-400", className)}>
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "brand" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
    brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
    danger: "bg-red-50 text-red-700 ring-red-600/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Read-only value with a copy button. Falls back to selecting the text on plain http. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const id = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(id) as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        className="bg-zinc-50 font-mono text-[13px] text-zinc-600"
      />
      <Button variant="secondary" onClick={copy}>
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}

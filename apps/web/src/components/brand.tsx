import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";
import { useAppTheme } from "../lib/theme.ts";

/**
 * OpenTurnly's mark: an open clock face with the booked slot in its gap. Drawn in
 * `currentColor`; the source artwork is in docs/brand. `animated` draws the face in, then
 * lets the hands tick and the slot breathe, gently (see .logo-animated in styles.css).
 */
export function LogoMark({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 880 880"
      fill="none"
      className={cn(animated && "logo-animated", className)}
      aria-hidden
    >
      <g stroke="currentColor" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round">
        <path className="logo-face" pathLength={1} d="M528.5 81A370 370 0 1 0 805.2 387.2" />
        <path className="logo-hands" d="M441 282V469H573" />
      </g>
      <rect
        className="logo-slot"
        x="652"
        y="124"
        width="151"
        height="152"
        rx="44"
        fill="currentColor"
      />
    </svg>
  );
}

/** Mark and name. Always in OpenTurnly's petrol, whatever a business's own colour is. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-900",
        className,
      )}
    >
      <LogoMark className="size-7 text-teal-700" />
      OpenTurnly
    </span>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "es";
  return (
    <fieldset
      className={cn("inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-medium", className)}
    >
      <legend className="sr-only">{t("nav.language")}</legend>
      {(["es", "en"] as const).map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => i18n.changeLanguage(language)}
          aria-pressed={current === language}
          className={cn(
            "rounded-md px-2 py-1 uppercase transition-colors",
            current === language
              ? "bg-white text-zinc-900 shadow-sm"
              : "text-zinc-500 hover:text-zinc-900",
          )}
        >
          {language}
        </button>
      ))}
    </fieldset>
  );
}

/** Centered card used by setup, login and invitation pages: the brand on top, language below. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  useAppTheme();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark animated className="size-12 text-teal-700" />
          <p className="mt-3 text-lg font-semibold tracking-tight text-zinc-900">OpenTurnly</p>
          <p className="mt-0.5 text-sm text-zinc-500">{t("brand.tagline")}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs sm:p-8">
          <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-zinc-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}

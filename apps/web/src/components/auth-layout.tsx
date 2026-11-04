import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/theme.ts";
import { AgendaPreview } from "./agenda-preview.tsx";
import { LanguageSwitcher, LogoMark } from "./brand.tsx";

export type AuthIdentity = {
  name: string;
  /** The line on the side panel, in place of the default one. */
  headline?: string | null;
  /** A photo for the side panel, in place of the look at the calendar. */
  photoUrl?: string | null;
};

/** Who these pages present. A deployment can replace this to show its own name, line and photo. */
export function useAuthIdentity(): AuthIdentity {
  return { name: "OpenTurnly" };
}

const FORM_SIDE = {
  background:
    "radial-gradient(70% 55% at 0% 0%, color-mix(in oklab, var(--color-brand-100) 75%, transparent), transparent), radial-gradient(60% 50% at 100% 100%, color-mix(in oklab, var(--color-brand-100) 75%, transparent), transparent), var(--color-zinc-50)",
};

// The brand's darkest tones, with two soft lights so one flat colour doesn't look cheap.
const PANEL_SIDE = {
  background:
    "radial-gradient(55% 45% at 85% 5%, color-mix(in oklab, var(--color-brand-500) 60%, transparent), transparent), radial-gradient(50% 45% at 5% 100%, color-mix(in oklab, var(--color-brand-400) 45%, transparent), transparent), linear-gradient(155deg, var(--color-brand-900), var(--color-brand-800))",
};

/**
 * Setup, sign-in and invitations: the form on a floating card, and beside it a line over a photo
 * or over a look at the product. On a phone there's only room for the form.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  useAppTheme();
  const { name, headline, photoUrl } = useAuthIdentity();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <main
        className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-16"
        style={FORM_SIDE}
      >
        <LanguageSwitcher className="absolute top-4 right-4" />
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-3">
            <LogoMark className="size-10 rounded-lg text-teal-700" />
            <span className="text-xl font-semibold tracking-tight text-zinc-900">{name}</span>
          </div>
          <div className="rounded-3xl bg-white p-7 shadow-xl ring-1 shadow-zinc-950/5 ring-zinc-950/5 sm:p-10">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {title}
              </h1>
              {subtitle && <p className="mt-2 text-sm text-zinc-500">{subtitle}</p>}
            </div>
            {/* The usual fields, with more room to breathe here than in the panel. */}
            <div className="mt-8 [&_button[type=submit]]:h-12 [&_button[type=submit]]:w-full [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:text-[15px] [&_input]:h-11 [&_input]:rounded-xl">
              {children}
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-zinc-400">
            © {new Date().getFullYear()} {name}
          </p>
        </div>
      </main>

      <aside
        // `light` keeps this side's tones when the page is in the dark theme.
        className="light relative hidden flex-col overflow-hidden p-12 text-white lg:flex xl:p-16"
        style={photoUrl ? { backgroundColor: "#18181b" } : PANEL_SIDE}
      >
        {photoUrl ? (
          <>
            <img src={photoUrl} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black/60" />
          </>
        ) : (
          <>
            <div className="panel-drift absolute -top-32 -right-24 size-[28rem] rounded-full bg-brand-400/25 blur-3xl" />
            <div className="panel-drift-slow absolute -bottom-40 -left-24 size-[30rem] rounded-full bg-brand-300/20 blur-3xl" />
          </>
        )}
        <div className="relative max-w-lg">
          <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold tracking-widest uppercase ring-1 ring-white/10 backdrop-blur">
            {name}
          </span>
          <p className="mt-6 text-4xl leading-[1.15] font-bold tracking-tight xl:text-[42px]">
            {headline || t("auth.headline")}
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/75">
            {t("auth.detail")}
          </p>
        </div>
        {!photoUrl && (
          <div className="relative mt-auto w-full max-w-lg self-center pt-12">
            <AgendaPreview />
          </div>
        )}
      </aside>
    </div>
  );
}

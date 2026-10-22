import type { PageTheme } from "@openturnly/core";
import type { CSSProperties } from "react";
import { cn } from "../lib/cn.ts";

const brand = (amount: number) =>
  `color-mix(in oklab, var(--color-brand-600) ${amount}%, transparent)`;

/** Layers of each look. They use the brand colour variables, so they follow the brand. */
const THEMES: Record<Exclude<PageTheme, "cover">, CSSProperties> = {
  soft: {
    background: `radial-gradient(120% 70% at 50% -10%, ${brand(22)} 0%, transparent 65%), #f7f7f8`,
  },
  aurora: {
    background: [
      `radial-gradient(45% 50% at 12% 8%, ${brand(45)} 0%, transparent 70%)`,
      `radial-gradient(40% 45% at 88% 12%, ${brand(30)} 0%, transparent 70%)`,
      `radial-gradient(50% 50% at 70% 95%, color-mix(in oklab, var(--color-brand-600) 25%, #38bdf8 25%) 0%, transparent 70%)`,
      "#f5f7f7",
    ].join(", "),
  },
  plain: { background: "#f4f4f5" },
  dark: {
    background: `radial-gradient(90% 60% at 50% -5%, ${brand(55)} 0%, transparent 60%), #09090b`,
  },
};

/** Whether text placed straight on the background should be light. */
export function isDarkTheme(theme: PageTheme) {
  return theme === "dark";
}

/**
 * The background behind the booking card. "cover" blurs the cover photo into a wash of
 * its colours (without a cover it falls back to "soft").
 */
export function BookingBackdrop({
  theme,
  coverUrl,
  fixed = false,
  className,
}: {
  theme: PageTheme;
  coverUrl: string | null;
  /** Fills the window behind the page; otherwise fills its positioned parent. */
  fixed?: boolean;
  className?: string;
}) {
  const position = fixed ? "fixed" : "absolute";
  if (theme === "cover" && coverUrl) {
    return (
      <div
        aria-hidden
        className={cn(position, "pointer-events-none inset-0 -z-10 overflow-hidden", className)}
      >
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 size-full scale-125 object-cover blur-3xl saturate-150"
        />
        <div className="absolute inset-0 bg-white/55" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn(position, "pointer-events-none inset-0 -z-10", className)}
      style={THEMES[theme === "cover" ? "soft" : theme]}
    />
  );
}

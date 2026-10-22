import type { CSSProperties } from "react";

/** Accent colours offered in Settings; the first is OpenTurnly's own. */
export const BRAND_COLORS = [
  "#0f766e",
  "#2563eb",
  "#0284c7",
  "#4f46e5",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
  "#18181b",
];

export const DEFAULT_BRAND = BRAND_COLORS[0] as string;

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** True for colours where dark text reads better than white. */
export function isLight(hex: string) {
  const light = luminance(hex);
  // Contrast with near-black (#18181b, luminance ≈ 0.009) vs. with white.
  return (light + 0.05) / 0.0591 > 1.05 / (light + 0.05);
}

/**
 * CSS variables that repaint every `brand-*` utility with a business's colour, so the
 * booking page (and its preview) follow the brand without separate styles.
 */
export function brandStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  const mix = (amount: number, base: string) => `color-mix(in oklab, ${color} ${amount}%, ${base})`;
  return {
    "--color-brand-50": mix(8, "white"),
    "--color-brand-100": mix(16, "white"),
    "--color-brand-200": mix(30, "white"),
    "--color-brand-300": mix(50, "white"),
    "--color-brand-400": mix(70, "white"),
    "--color-brand-500": mix(85, "white"),
    "--color-brand-600": color,
    "--color-brand-700": mix(80, "black"),
    "--color-brand-800": mix(65, "black"),
    "--color-brand-900": mix(40, "black"),
    "--color-on-brand": isLight(color) ? "#18181b" : "#ffffff",
  } as CSSProperties;
}

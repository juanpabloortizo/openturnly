import { CURRENCIES } from "@openturnly/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ComboboxOption } from "../components/combobox.tsx";
import { api } from "./api.ts";

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const CURRENCY_BY_ZONE: Record<string, (typeof CURRENCIES)[number]> = {
  "America/Bogota": "COP",
  "America/Mexico_City": "MXN",
  "America/Monterrey": "MXN",
  "America/Tijuana": "MXN",
  "America/Santiago": "CLP",
  "America/Lima": "PEN",
  "America/Montevideo": "UYU",
  "America/Asuncion": "PYG",
  "America/La_Paz": "BOB",
  "America/Guatemala": "GTQ",
  "America/Costa_Rica": "CRC",
  "America/Santo_Domingo": "DOP",
  "America/Sao_Paulo": "BRL",
  "Europe/Madrid": "EUR",
};

export function guessCurrency(timeZone: string): (typeof CURRENCIES)[number] {
  if (timeZone.startsWith("America/Argentina")) return "ARS";
  return CURRENCY_BY_ZONE[timeZone] ?? "USD";
}

export function formatDate(iso: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(iso));
}

/** Host shown before the slug, e.g. "reservas.example.com/". */
export function publicHost() {
  return `${window.location.host}/`;
}

function offsetOf(zone: string, now: Date) {
  return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
}

/**
 * Every time zone as "Bogota · Colombia · GMT-5", grouped by country, so it can be found
 * by city, country or offset.
 */
export function useTimeZoneOptions(language: string): ComboboxOption[] {
  const countries = useTimeZoneCountries();
  return useMemo(() => {
    const regions = new Intl.DisplayNames([language], { type: "region" });
    const now = new Date();
    return Intl.supportedValuesOf("timeZone")
      .map((zone) => {
        const country = countries[zone];
        const countryName = country ? regions.of(country) : undefined;
        return {
          value: zone,
          label: (zone.split("/").at(-1) ?? zone).replaceAll("_", " "),
          detail: [countryName, offsetOf(zone, now)].filter(Boolean).join(" · "),
          keywords: `${zone} ${country ?? ""}`,
          sortKey: `${countryName ?? "~"} ${zone}`,
        };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, language))
      .map(({ sortKey: _, ...option }) => option);
  }, [countries, language]);
}

/** { "America/Bogota": "CO", … }: the country each time zone belongs to. */
export function useTimeZoneCountries(): Record<string, string> {
  const meta = useQuery({
    queryKey: ["meta", "timezones"],
    queryFn: () => api<{ countries: Record<string, string> }>("/api/meta/timezones"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return meta.data?.countries ?? EMPTY;
}

const EMPTY: Record<string, string> = {};

/** "COP · peso colombiano", for the currency picker. */
export function currencyOptions(language: string): ComboboxOption[] {
  const names = new Intl.DisplayNames([language], { type: "currency" });
  return CURRENCIES.map((code) => ({ value: code, label: code, detail: names.of(code) }));
}

/** "Colombia", in the admin's language. */
export function countryName(code: string, language: string) {
  return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code;
}

/** "CO" → 🇨🇴 */
export function flag(country: string) {
  return String.fromCodePoint(...[...country].map((char) => 0x1f1a5 + char.charCodeAt(0)));
}

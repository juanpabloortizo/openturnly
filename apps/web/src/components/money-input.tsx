import { fromMinorUnits, toMinorUnits } from "@openturnly/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";
import { currencySymbol } from "../lib/format.ts";
import { Input } from "./ui.tsx";

const toText = (amount: number, currency: string) =>
  amount === 0 ? "" : String(fromMinorUnits(amount, currency));

/**
 * An amount typed in the currency's main unit ("25000" or "12,50") and kept in minor units,
 * with the currency symbol in front. Empty reads as 0.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  id,
  className,
  invalid,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (amount: number) => void;
  currency: string;
  id?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { i18n } = useTranslation();
  const [text, setText] = useState(() => toText(value, currency));

  // Follow changes made from outside (a total filled in for you) without fighting the typing.
  useEffect(() => {
    setText((current) => {
      const typed = Number(current.replace(",", "."));
      const same = (Number.isNaN(typed) ? 0 : toMinorUnits(typed, currency)) === value;
      return same ? current : toText(value, currency);
    });
  }, [value, currency]);

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
        {currencySymbol(currency, i18n.resolvedLanguage ?? "es")}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="0"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className="pl-8 text-right tabular-nums"
        value={text}
        onChange={(event) => {
          const clean = event.target.value.replace(/[^\d.,]/g, "");
          setText(clean);
          const amount = Number(clean.replace(",", "."));
          onChange(Number.isNaN(amount) ? 0 : toMinorUnits(amount, currency));
        }}
      />
    </div>
  );
}

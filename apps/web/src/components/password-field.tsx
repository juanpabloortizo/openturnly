import { Check, Copy, Eye, EyeOff, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { generatePassword } from "../lib/password.ts";
import { Button, Input } from "./ui.tsx";

/**
 * A password typed or generated here for someone else: shown by default (it has to be
 * passed on), with buttons to generate a strong one and to copy it.
 */
export function PasswordField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Without clipboard access (plain http), the password stays visible to copy by hand.
      setVisible(true);
    }
  };

  return (
    // Narrow spots (a form column) keep room for the password by showing only the icons.
    <div className="@container flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="pr-9 font-mono tracking-wide"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-zinc-400 hover:text-zinc-700"
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
      <Button
        variant="secondary"
        onClick={() => {
          onChange(generatePassword());
          setVisible(true);
        }}
        title={t("access.generate")}
        aria-label={t("access.generate")}
      >
        <Sparkles className="size-4 text-brand-600" aria-hidden />
        <span className="hidden @sm:inline">{t("access.generate")}</span>
      </Button>
      <Button
        variant="secondary"
        size="icon"
        className="size-9"
        onClick={copy}
        disabled={!value}
        aria-label={t("common.copy")}
        title={t("common.copy")}
      >
        {copied ? (
          <Check className="size-4 text-emerald-600" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}

import { formatPhone, normalizePhone } from "@openturnly/core";
import { Mail, MapPin, Phone } from "lucide-react";
import { cn } from "../lib/cn.ts";

export type BookingHeaderBusiness = {
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
};

/** "3043561234" in Colombia → "+57 304 3561234"; anything unparseable is shown as typed. */
function displayPhone(phone: string, country: string | null) {
  const normalized = normalizePhone(phone, country ?? undefined);
  return normalized ? formatPhone(normalized) : phone;
}

/**
 * Top of the booking card: cover photo, logo, name, description and contact details.
 * The details are information only, not links, so nobody leaves the booking by accident.
 */
export function BookingHeader({
  business,
  compact = false,
}: {
  business: BookingHeaderBusiness;
  /** Smaller version for the preview in Settings. */
  compact?: boolean;
}) {
  const { name, description, address, phone, email, country, logoUrl, coverUrl } = business;
  const details = [
    { icon: MapPin, value: address },
    { icon: Phone, value: phone ? displayPhone(phone, country) : null },
    { icon: Mail, value: email },
  ].filter((detail): detail is { icon: typeof MapPin; value: string } => Boolean(detail.value));

  return (
    <header>
      <div
        className={cn(
          "relative overflow-hidden bg-gradient-to-br from-brand-700 to-brand-500",
          compact ? "h-20" : "h-36 sm:h-52",
        )}
      >
        {coverUrl && (
          <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
      </div>
      <div className={compact ? "px-4" : "px-5 sm:px-8"}>
        <div
          className={cn(
            "relative z-10 grid place-items-center overflow-hidden bg-white font-semibold text-zinc-800 shadow-lg ring-white",
            compact
              ? "-mt-7 size-14 rounded-xl text-lg ring-[3px]"
              : "-mt-11 size-20 rounded-2xl text-2xl ring-4 sm:-mt-14 sm:size-24",
          )}
        >
          {logoUrl ? (
            <img src={logoUrl} alt={name} className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center bg-brand-50 text-brand-700">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <h1
          className={cn(
            "font-semibold tracking-tight text-zinc-900",
            compact ? "mt-2 text-base" : "mt-4 text-2xl sm:text-[30px]",
          )}
        >
          {name}
        </h1>
        {description && (
          <p
            className={cn(
              "whitespace-pre-line text-zinc-600",
              compact ? "mt-1 line-clamp-2 text-xs" : "mt-1.5 max-w-2xl text-[15px]",
            )}
          >
            {description}
          </p>
        )}
        {details.length > 0 && (
          <ul
            className={cn(
              "flex flex-wrap text-zinc-500",
              compact ? "mt-2 gap-x-3 gap-y-1 text-[11px]" : "mt-3 gap-x-5 gap-y-1.5 text-[13px]",
            )}
          >
            {details.map(({ icon: Icon, value }) => (
              <li key={value} className="inline-flex min-w-0 items-center gap-1.5">
                <Icon
                  className={cn("shrink-0 text-zinc-400", compact ? "size-3" : "size-3.5")}
                  aria-hidden
                />
                <span className="truncate">{value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}

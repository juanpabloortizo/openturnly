import { cn } from "../lib/cn.ts";

/** "Ana María Pérez" → "AM". */
export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** A person's photo in a circle, or their initials when they have none. */
export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null | undefined;
  className?: string;
}) {
  return url ? (
    <img
      src={url}
      alt=""
      className={cn("size-9 shrink-0 rounded-full bg-zinc-100 object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-[13px] font-semibold text-brand-700",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

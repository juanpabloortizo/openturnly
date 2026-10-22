import type { InputHTMLAttributes } from "react";
import { publicHost } from "../lib/locale.ts";
import { Input } from "./ui.tsx";

/** Slug input prefixed with the site's host, e.g. "reservas.example.com/ [mi-barberia]". */
export function SlugInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const host = publicHost();
  return (
    <div className="flex">
      <span
        title={host}
        className="block max-w-[55%] shrink-0 truncate rounded-l-md border border-r-0 border-zinc-200 bg-zinc-50 px-3 text-sm leading-[34px] text-zinc-500"
      >
        <span className="sm:hidden">/</span>
        <span className="hidden sm:inline">{host}</span>
      </span>
      <Input {...props} className="min-w-0 rounded-l-none" />
    </div>
  );
}

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "../lib/cn.ts";

type Toast = { id: number; tone: "success" | "error"; message: string };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function show(tone: Toast["tone"], message: string) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone, message }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
}

/** Short in-app notifications: `toast.success(t("common.saved"))`. */
export const toast = {
  success: (message: string) => show("success", message),
  error: (message: string) => show("error", message),
};

export function Toaster() {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === "error" ? "alert" : "status"}
          className="pointer-events-auto flex w-full max-w-sm animate-[toast-in_180ms_ease-out] items-start gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-lg"
        >
          {item.tone === "success" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
          )}
          <p className={cn("flex-1", item.tone === "error" && "text-red-800")}>{item.message}</p>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="-mr-1 rounded p-0.5 text-zinc-400 hover:text-zinc-700"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

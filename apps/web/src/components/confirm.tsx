import { TriangleAlert } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "./ui.tsx";

type ConfirmOptions = {
  title: string;
  description?: string;
  /** A list under the description, e.g. everything that will be deleted. */
  details?: string[];
  confirmLabel: string;
  tone?: "danger" | "default";
  /**
   * The person must type this phrase (shown in quotes, case doesn't matter) to enable the
   * button, for irreversible actions.
   */
  requireText?: string;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * In-app confirmation dialogs instead of the browser's `window.confirm`:
 * `if (await confirm({ title, confirmLabel, tone: "danger" })) remove()`.
 *
 * While one is open, any other open dialog steps aside (see `data-confirming` in
 * styles.css), so a confirmation asked from inside a form never shows two stacked modals.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const confirm = useCallback<Confirm>((next) => {
    setTyped("");
    setOptions(next);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const root = document.documentElement;
    if (options) {
      if (!element.open) {
        root.dataset.confirming = "";
        element.showModal();
      }
      // Start on the safe choice, or on the text to type (also when one follows another).
      (textInput.current ?? cancelButton.current)?.focus();
    }
    if (!options && element.open) {
      element.close();
      delete root.dataset.confirming;
    }
  }, [options]);

  const locked =
    Boolean(options?.requireText) &&
    typed.trim().toLowerCase() !== options?.requireText?.toLowerCase();
  const danger = options?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking the backdrop cancels; Escape is handled by <dialog>. */}
      <dialog
        ref={dialog}
        data-confirm-dialog
        role="alertdialog"
        aria-labelledby="confirm-title"
        onClose={() => {
          delete document.documentElement.dataset.confirming;
          if (resolver.current) close(false);
        }}
        onClick={(event) => {
          if (event.target === dialog.current) close(false);
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-black/50"
      >
        {options && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!locked) close(true);
            }}
          >
            <div className="flex gap-4 px-5 pt-5 pb-4">
              {danger && (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
                  <TriangleAlert className="size-[18px]" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                <h2 id="confirm-title" className="text-[15px] font-semibold text-zinc-900">
                  {options.title}
                </h2>
                {options.description && (
                  <p className="text-sm text-zinc-500">{options.description}</p>
                )}
                {options.details && (
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-600 marker:text-zinc-300">
                    {options.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                )}
                {options.requireText && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm text-zinc-700">
                      {t("common.typeToConfirm")}{" "}
                      <strong className="font-semibold text-zinc-900">
                        “{options.requireText}”
                      </strong>
                    </p>
                    <Input
                      ref={textInput}
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      placeholder={options.requireText}
                      aria-label={options.requireText}
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/70 px-5 py-3">
              <Button ref={cancelButton} variant="secondary" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant={danger ? "danger" : "primary"} disabled={locked}>
                {options.confirmLabel}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

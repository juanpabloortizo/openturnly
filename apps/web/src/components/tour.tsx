import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";
import { Button } from "./ui.tsx";

export type TourStep = {
  /** The `data-tour` of what the step points at; without one, the card shows in the middle. */
  target?: string;
  title: string;
  body: string;
  /** Shown above the title, for a welcome. */
  icon?: ReactNode;
  /** Labels instead of "Next" and "Skip", like "Start" and "Not now" on a welcome. */
  next?: string;
  skip?: string;
};

/** Space between what's pointed at and its highlight, and from the highlight to the card. */
const PAD = 6;
const GAP = 14;
/** Closest the card gets to the window's edges. */
const MARGIN = 12;

type Box = { top: number; left: number; width: number; height: number };

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/** The first element marked `data-tour={name}` that is on screen; null if all are hidden. */
function findTarget(name: string) {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)];
  const visible = all.find((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  return { found: all.length > 0, element: visible ?? null };
}

/** Beside the highlight when there's room (the sidebar), else below, above or to its left. */
function placeCard(spot: Box, card: { width: number; height: number }): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (top: number) => Math.max(MARGIN, Math.min(top, vh - card.height - MARGIN));
  const clampLeft = (left: number) => Math.max(MARGIN, Math.min(left, vw - card.width - MARGIN));
  const middleTop = clampTop(spot.top + spot.height / 2 - card.height / 2);
  const middleLeft = clampLeft(spot.left + spot.width / 2 - card.width / 2);
  const right = spot.left + spot.width + GAP;
  if (spot.left < vw / 2 && right + card.width + MARGIN <= vw) {
    return { top: middleTop, left: right };
  }
  const below = spot.top + spot.height + GAP;
  if (below + card.height + MARGIN <= vh) return { top: below, left: middleLeft };
  const above = spot.top - GAP - card.height;
  if (above >= MARGIN) return { top: above, left: middleLeft };
  const left = spot.left - GAP - card.width;
  if (left >= MARGIN) return { top: middleTop, left };
  return { top: vh - card.height - MARGIN, left: middleLeft };
}

/**
 * A guided tour: it dims the page, lights up and pulses around one thing at a time and
 * explains it in a card. Steps whose target isn't on the page are skipped; targets that are
 * there but hidden (the sidebar on a phone) are explained in the middle of the screen.
 * `onFinish` runs when it's done or skipped.
 */
export function Tour({ steps, onFinish }: { steps: TourStep[]; onFinish: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [ready, setReady] = useState(false);
  const [spot, setSpot] = useState<Box | null>(null);
  const [card, setCard] = useState({ width: 352, height: 200 });
  const target = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = steps[index];
  const last = index === steps.length - 1;

  const go = (next: number) => {
    if (next >= steps.length) return onFinish();
    setDirection(next < index ? -1 : 1);
    setIndex(Math.max(0, next));
  };

  // Find what the step points at, waiting a little for the page to show it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per step.
  useEffect(() => {
    if (!step) return;
    setReady(false);
    target.current = null;
    setSpot(null);
    if (!step.target) {
      setReady(true);
      return;
    }
    const name = step.target;
    let tries = 0;
    let timer = 0;
    const locate = () => {
      const { found, element } = findTarget(name);
      if (element) {
        const box = element.getBoundingClientRect();
        if (box.top < MARGIN || box.bottom > window.innerHeight - MARGIN) {
          element.scrollIntoView({ block: "center", inline: "nearest" });
        }
        target.current = element;
        setReady(true);
      } else if (found) {
        setReady(true);
      } else if (tries++ < 20) {
        timer = window.setTimeout(locate, 100);
      } else if (index + direction < 0) {
        go(index + 1);
      } else {
        go(index + direction);
      }
    };
    locate();
    return () => window.clearTimeout(timer);
  }, [index]);

  // Follow the target while the page scrolls, resizes or moves it.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const track = () => {
      const element = target.current;
      if (element) {
        const box = element.getBoundingClientRect();
        const next = {
          top: box.top - PAD,
          left: box.left - PAD,
          width: box.width + PAD * 2,
          height: box.height + PAD * 2,
        };
        setSpot((current) => (current && sameBox(current, next) ? current : next));
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // The card's real size, to place it.
  useLayoutEffect(() => {
    const box = cardRef.current?.getBoundingClientRect();
    if (!box) return;
    if (Math.abs(box.width - card.width) > 1 || Math.abs(box.height - card.height) > 1) {
      setCard({ width: box.width, height: box.height });
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves with each step.
  useEffect(() => {
    if (ready) primary.current?.focus({ preventScroll: true });
  }, [ready, index]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read the current step.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onFinish();
      } else if (event.key === "ArrowRight") {
        go(index + 1);
      } else if (event.key === "ArrowLeft" && index > 0) {
        go(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length]);

  if (!step || !ready) return null;
  const pointed = target.current && spot;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {pointed ? (
        <>
          <div
            className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
            style={{ ...spot, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)" }}
          />
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-brand-400 transition-all duration-300 ease-out motion-safe:animate-[tour-pulse_1.8s_ease-out_infinite]"
            style={spot}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div
        className="absolute transition-[top,left] duration-300 ease-out"
        style={
          pointed
            ? placeCard(spot, card)
            : {
                top: Math.max(MARGIN, (window.innerHeight - card.height) / 2),
                left: Math.max(MARGIN, (window.innerWidth - card.width) / 2),
              }
        }
      >
        <div
          key={index}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="w-[min(22rem,calc(100vw-1.5rem))] animate-[tour-in_200ms_ease-out] rounded-xl bg-white p-5 shadow-2xl ring-1 ring-zinc-200"
        >
          {step.icon && <div className="mb-3">{step.icon}</div>}
          {steps.length > 1 && (
            <div className="mb-3 flex items-center gap-1.5" aria-hidden>
              {steps.map((item, position) => (
                <span
                  key={item.title}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    position === index ? "w-5 bg-brand-600" : "w-1.5 bg-zinc-200",
                    position < index && "bg-brand-300",
                  )}
                />
              ))}
              <span className="ml-auto text-xs text-zinc-400">
                {t("tour.stepOf", { current: index + 1, total: steps.length })}
              </span>
            </div>
          )}
          <h2 id={titleId} className="text-[15px] font-semibold text-zinc-900">
            {step.title}
          </h2>
          <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-zinc-600">
            {step.body}
          </p>
          <div className="mt-5 flex items-center gap-2">
            {!last && (
              <button
                type="button"
                onClick={onFinish}
                className="mr-auto rounded-md px-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-900"
              >
                {step.skip ?? t("tour.skip")}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {index > 0 && (
                <Button variant="secondary" size="sm" onClick={() => go(index - 1)}>
                  {t("tour.back")}
                </Button>
              )}
              <Button ref={primary} size="sm" onClick={() => go(index + 1)}>
                {step.next ??
                  (last ? t(steps.length > 1 ? "tour.done" : "tour.gotIt") : t("tour.next"))}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

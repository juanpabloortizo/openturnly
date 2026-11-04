/**
 * A look at the product beside the sign-in form, for the people who run it: a day in one
 * business's calendar that keeps moving. An appointment gets confirmed, a new booking arrives and
 * the day scrolls to make room for it, then the same happens in the next business. Drawn rather
 * than pictured, so it follows the brand colour and the language. Everyone in it is made up.
 */

import { CalendarCheck, Check, ChevronsUpDown, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.ts";

const BUSINESSES = ["center", "north", "south"] as const;
const SERVICES = ["beard", "facial", "manicure", "visit", "cut"] as const;
const TIMES = ["09:00", "10:30", "11:15", "15:00", "16:30"];
const CUSTOMERS = ["Laura", "Sofía", "Daniela", "Andrés", "Carlos"];
const PROFESSIONALS = ["Camila", "Mateo", "Valentina"];

/** Each round shows the next business, with its own day. */
function inRound<T>(list: readonly T[], index: number, round: number) {
  return list[(index + round) % list.length] as T;
}

/** How long each moment lasts: settled, confirmed, booking arrives, day moves, toast leaves. */
const MOMENTS = [2200, 1600, 1200, 2800, 2200];
const CONFIRMED = 1;
const BOOKING = 2;
const MOVED = 3;

const ROW_HEIGHT = 64;
const VISIBLE_ROWS = 4;
const THE_ONE_THAT_CONFIRMS = 2;
const THE_NEW_ONE = 4;

function canMove() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones never show this panel.
  return !reduced && window.matchMedia("(min-width: 1024px)").matches;
}

function useTimeline() {
  const [moment, setMoment] = useState(0);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!canMove()) return;
    const timer = setTimeout(() => {
      if (moment < MOMENTS.length - 1) {
        setMoment(moment + 1);
      } else {
        setMoment(0);
        setRound(round + 1);
      }
    }, MOMENTS[moment]);
    return () => clearTimeout(timer);
  }, [moment, round]);
  return { moment, round };
}

export function AgendaPreview() {
  const { t, i18n } = useTranslation();
  const { moment, round } = useTimeline();
  const date = new Date().toLocaleDateString(i18n.resolvedLanguage, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const business = t(`auth.preview.businesses.${inRound(BUSINESSES, 0, round)}`);
  const newest = TIMES.length - 1;
  const newCustomer = inRound(CUSTOMERS, newest, round);
  const appointments = 8 + (moment >= MOVED ? 1 : 0);
  const confirmed = 6 + (moment >= CONFIRMED ? 1 : 0) + (moment >= MOVED ? 1 : 0);
  const toastShown = moment === BOOKING || moment === MOVED;

  return (
    <div aria-hidden className="agenda-float relative">
      <div className="agenda-rise overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl ring-1 ring-black/5">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
          <span
            key={business}
            className="agenda-pop flex items-center gap-1.5 text-sm font-semibold"
          >
            <Store className="size-4 text-brand-600" />
            {business}
            <ChevronsUpDown className="size-3.5 text-zinc-400" />
          </span>
          <span className="text-xs text-zinc-500">
            {t("auth.preview.today")}, {date}
          </span>
          <span className="relative ml-1 flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-500 opacity-60" />
            <span className="relative size-2 rounded-full bg-brand-600" />
          </span>
        </div>

        <div className="overflow-hidden" style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}>
          <ul
            key={round}
            className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateY(${moment >= MOVED ? -ROW_HEIGHT : 0}px)` }}
          >
            {TIMES.map((time, index) => {
              const service = t(`auth.preview.services.${inRound(SERVICES, index, round)}`);
              const customer = inRound(CUSTOMERS, index, round);
              const professional = inRound(PROFESSIONALS, index, round);
              const waiting = index === THE_ONE_THAT_CONFIRMS && moment < CONFIRMED;
              const justConfirmed = index === THE_ONE_THAT_CONFIRMS && moment === CONFIRMED;
              const isNew = index === THE_NEW_ONE;
              // Stays on once set: taking it off would replay the row's entrance.
              const flashed =
                (index === THE_ONE_THAT_CONFIRMS && moment >= CONFIRMED) ||
                (isNew && moment >= MOVED);
              return (
                <li
                  key={time}
                  className={cn(
                    "flex items-center gap-3 border-b border-zinc-100 px-5",
                    flashed ? "agenda-flash" : !isNew && "agenda-rise",
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    animationDelay: flashed ? undefined : `${150 + index * 110}ms`,
                  }}
                >
                  <span className="w-11 shrink-0 text-xs font-medium text-zinc-500 tabular-nums">
                    {time}
                  </span>
                  <span
                    className={cn(
                      "h-8 w-1 rounded-full transition-colors duration-500",
                      waiting ? "bg-brand-200" : "bg-brand-600",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{service}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {t("auth.preview.withProfessional", { customer, professional })}
                    </span>
                  </span>
                  <span
                    key={waiting ? "waiting" : "confirmed"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      waiting ? "bg-zinc-100 text-zinc-600" : "bg-brand-50 text-brand-700",
                      justConfirmed && "agenda-pop",
                    )}
                  >
                    {justConfirmed && <Check className="size-3" strokeWidth={3} />}
                    {t(waiting ? "auth.preview.pending" : "auth.preview.confirmed")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 bg-zinc-50 px-5 py-3 text-xs text-zinc-500">
          <span key={appointments} className="agenda-pop">
            {t("auth.preview.summary", { businesses: BUSINESSES.length, appointments })}
          </span>
          <span key={confirmed} className="agenda-pop">
            {t("auth.preview.share", { confirmed })}
          </span>
        </div>
      </div>

      <div
        className={cn(
          "absolute -top-10 -right-4 flex items-center gap-2.5 rounded-xl bg-white py-2.5 pr-4 pl-3 text-zinc-900 shadow-xl ring-1 ring-black/5",
          "transition duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          toastShown ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-90 opacity-0",
        )}
      >
        <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <CalendarCheck className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-semibold">{t("auth.preview.booked")}</span>
          <span className="block text-[11px] text-zinc-500">
            {t("auth.preview.bookedDetail", {
              customer: newCustomer,
              time: inRound(TIMES, newest, 0),
            })}
          </span>
        </span>
      </div>
    </div>
  );
}

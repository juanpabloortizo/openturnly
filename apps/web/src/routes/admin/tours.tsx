import type { Tour as TourName } from "@openturnly/core";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { LogoMark } from "../../components/brand.tsx";
import { Tour, type TourStep } from "../../components/tour.tsx";
import type { Business, User } from "../../lib/api.ts";
import { useSeenTours, useTourMutations } from "../../lib/tours.ts";

/** The section tours, by the page's path inside the business. */
const SECTIONS: Record<string, TourName> = {
  "": "agenda",
  customers: "customers",
  services: "services",
  professionals: "professionals",
  hours: "hours",
  settings: "settings",
};

/** The sections the welcome tour walks through, for people who manage the business. */
const MANAGED = ["customers", "services", "professionals", "hours", "settings"] as const;

function stepsOf(
  t: TFunction,
  tour: TourName,
  { professional, owner }: { professional: boolean; owner: boolean },
): TourStep[] {
  switch (tour) {
    case "welcome":
      return [
        {
          icon: <LogoMark className="size-10 text-teal-700" />,
          title: t("tour.welcome.intro.title"),
          body: t(professional ? "tour.welcome.intro.bodyProfessional" : "tour.welcome.intro.body"),
          next: t("tour.start"),
          skip: t("tour.later"),
        },
        {
          target: "business-switcher",
          title: t("tour.welcome.switcher.title"),
          body: t(owner ? "tour.welcome.switcher.bodyOwner" : "tour.welcome.switcher.body"),
        },
        {
          target: "nav-agenda",
          title: t("tour.welcome.agenda.title"),
          body: t(
            professional ? "tour.welcome.agenda.bodyProfessional" : "tour.welcome.agenda.body",
          ),
        },
        ...(professional
          ? []
          : MANAGED.map((section) => ({
              target: `nav-${section}`,
              title: t(`tour.welcome.${section}.title`),
              body: t(`tour.welcome.${section}.body`),
            }))),
        {
          target: "account",
          title: t("tour.welcome.account.title"),
          body: t("tour.welcome.account.body"),
        },
        { title: t("tour.welcome.end.title"), body: t("tour.welcome.end.body") },
      ];
    case "agenda":
      return (["new", "bookingPage", "calendar", "views"] as const).map((part) => ({
        target: `agenda-${part}`,
        title: t(`tour.agenda.${part}.title`),
        body: t(`tour.agenda.${part}.body`),
      }));
    case "customers":
      return (["new", "list"] as const).map((part) => ({
        target: `customers-${part}`,
        title: t(`tour.customers.${part}.title`),
        body: t(`tour.customers.${part}.body`),
      }));
    case "services":
    case "professionals":
      return [
        {
          target: `${tour}-new`,
          title: t(`tour.${tour}.new.title`),
          body: t(`tour.${tour}.new.body`),
        },
      ];
    case "hours":
    case "settings":
      return [
        {
          target: `${tour}-tabs`,
          title: t(`tour.${tour}.tabs.title`),
          body: t(`tour.${tour}.tabs.body`),
        },
      ];
  }
}

/**
 * The guided tours of a business's admin: the welcome tour the first time, then each
 * section's own the first time it's opened. Each shows once per person; "See the tour
 * again" in the account menu brings them all back.
 */
export function BusinessTours({ business, user }: { business: Business; user: User }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const seen = useSeenTours();
  const { finish } = useTourMutations();
  if (!seen.data) return null;

  const base = `/admin/businesses/${business.id}`;
  const section = SECTIONS[pathname.replace(/\/$/, "").slice(base.length).replace(/^\//, "")];
  const tour: TourName | undefined = !seen.data.includes("welcome")
    ? "welcome"
    : section && !seen.data.includes(section)
      ? section
      : undefined;
  if (!tour) return null;

  const steps = stepsOf(t, tour, {
    professional: business.access.role === "professional",
    owner: user.role === "owner",
  });
  return <Tour key={tour} steps={steps} onFinish={() => finish.mutate(tour)} />;
}

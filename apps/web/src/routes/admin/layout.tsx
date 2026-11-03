import {
  Building2,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Contact,
  Gift,
  MapPin,
  Menu,
  Package,
  Plus,
  Receipt,
  Scissors,
  Search,
  Settings,
  Store,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router";
import { Logo, LogoMark } from "../../components/brand.tsx";
import { searchable } from "../../components/combobox.tsx";
import { Spinner } from "../../components/ui.tsx";
import type { Business, User } from "../../lib/api.ts";
import { businessPath, useBusinesses } from "../../lib/businesses.ts";
import { cn } from "../../lib/cn.ts";
import { useLowStockCount } from "../../lib/inventory.ts";
import { loginPath, useInstallNotices, useMe } from "../../lib/session.ts";
import { useAppTheme } from "../../lib/theme.ts";
import { AccountMenu } from "./account.tsx";

const COLLAPSED_KEY = "openturnly.sidebarCollapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function AdminLayout() {
  const { t } = useTranslation();
  const me = useMe();
  const notices = useInstallNotices(me.data?.role === "owner");
  useAppTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // Private mode: the preference just isn't remembered.
    }
  }, [collapsed]);

  // Close the mobile drawer after navigating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every route change.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (me.isPending) return <Spinner className="min-h-screen" />;
  if (!me.data) return <Navigate to={loginPath()} replace />;
  const user = me.data;

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-zinc-200 bg-zinc-50 transition-[width] lg:block",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <SidebarContent user={user} collapsed={collapsed} />
        {/* On the sidebar's edge, so it stays in the same place open or collapsed. */}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          className="absolute -right-3 bottom-24 grid size-6 place-items-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-xs transition-colors hover:border-zinc-400 hover:text-zinc-900"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronLeft className="size-3.5" aria-hidden />
          )}
        </button>
      </aside>

      {/* Mobile top bar and drawer */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="-ml-1 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100"
          aria-label="Menu"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Logo />
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-900/40"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-zinc-50 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3.5 right-3 rounded-md p-1 text-zinc-400 hover:bg-zinc-100"
              aria-label="Close menu"
            >
              <X className="size-5" aria-hidden />
            </button>
            <SidebarContent user={user} collapsed={false} />
          </aside>
        </div>
      )}

      <main className={cn("transition-[padding]", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          {notices.data?.includes("proxy_not_trusted") && (
            <div className="mb-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
              <div>
                <p className="font-medium">{t("notices.proxyTitle")}</p>
                <p className="mt-0.5 text-amber-800">{t("notices.proxyBody")}</p>
              </div>
            </div>
          )}
          <Outlet context={user satisfies User} />
        </div>
      </main>
    </div>
  );
}

function SidebarContent({ user, collapsed }: { user: User; collapsed: boolean }) {
  const { t } = useTranslation();
  const { businessCode } = useParams();
  const businesses = useBusinesses();
  const current = businesses.data?.find((business) => business.shortId === businessCode);
  const base = businessCode ? `/admin/${businessCode}` : null;

  // Professionals only work with their own agenda.
  const role = current?.access.role;
  const manages = role !== "professional";
  const lowStock = useLowStockCount(current?.id ?? "", Boolean(current) && manages).data ?? 0;
  // The day-to-day first; sales and setting the business up fold into submenus, last.
  const leaf = (path: string, label: string, icon: NavLeaf["icon"], tour: string): NavLeaf => ({
    to: `${base}${path}`,
    label,
    icon,
    tour,
  });
  const businessNav: NavEntry[] = base
    ? [
        { to: base, label: t("nav.agenda"), icon: CalendarDays, end: true, tour: "agenda" },
        ...(manages
          ? [
              leaf("/customers", t("nav.customers"), Contact, "customers"),
              {
                ...leaf("/inventory", t("nav.inventory"), Package, "inventory"),
                badge: lowStock > 0 ? t("nav.lowStock", { count: lowStock }) : undefined,
                count: lowStock,
              },
              leaf("/reports", t("nav.reports"), ChartColumn, "reports"),
              {
                group: "sales" as const,
                label: t("nav.sales"),
                icon: Receipt,
                tour: "sales",
                children: [
                  leaf("/sales", t("nav.salesList"), Receipt, "sales-list"),
                  leaf("/cash", t("nav.cash"), Wallet, "cash"),
                  leaf("/gift-cards", t("nav.giftCards"), Gift, "gift-cards"),
                ],
              },
              {
                group: "admin" as const,
                label: t("nav.admin"),
                icon: Store,
                tour: "admin",
                children: [
                  leaf("/services", t("nav.services"), Scissors, "services"),
                  leaf("/professionals", t("nav.professionals"), Users, "professionals"),
                  leaf("/locations", t("nav.locations"), MapPin, "locations"),
                  leaf("/hours", t("nav.hours"), Clock3, "hours"),
                ],
              },
              leaf("/settings", t("nav.settings"), Settings, "settings"),
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn("flex h-16 shrink-0 items-center px-4", collapsed && "justify-center px-0")}
      >
        <Link to="/admin" aria-label="OpenTurnly" className="min-w-0">
          {collapsed ? <LogoMark className="size-8 text-teal-700" /> : <Logo />}
        </Link>
      </div>

      <div className="px-3">
        <BusinessSwitcher
          businesses={businesses.data ?? []}
          current={current}
          collapsed={collapsed}
          isOwner={user.role === "owner"}
        />
      </div>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {businessNav.map((entry, index) => {
          if ("children" in entry) {
            return <SidebarGroup key={entry.group} {...entry} collapsed={collapsed} />;
          }
          // Collapsed, a group opens with a divider; a page right after one gets its own.
          const previous = businessNav[index - 1];
          const afterGroup = collapsed && previous !== undefined && "children" in previous;
          return (
            <Fragment key={entry.to}>
              {afterGroup && <div className="mx-2 my-2 border-t border-zinc-200" />}
              <SidebarLink collapsed={collapsed} {...entry} />
            </Fragment>
          );
        })}
      </nav>

      <AccountMenu user={user} collapsed={collapsed} />
    </div>
  );
}

function navItemClass(active: boolean) {
  return cn(
    "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
    active
      ? "bg-zinc-200/70 font-semibold text-zinc-900 [&>svg]:text-brand-600"
      : "font-medium text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900 [&>svg]:text-zinc-400",
  );
}

type NavLeaf = {
  to: string;
  label: string;
  icon: typeof CalendarDays;
  /** Where the guided tour points at it: nav-<tour>. */
  tour: string;
  end?: boolean;
  /** Something that needs a look ("3 con stock bajo"), shown as a count. */
  badge?: string;
  count?: number;
};
type NavEntry =
  | NavLeaf
  | {
      group: "sales" | "admin";
      label: string;
      icon: typeof CalendarDays;
      tour: string;
      children: NavLeaf[];
    };

/**
 * A row that unfolds its pages underneath. It opens by itself on one of its pages; collapsed
 * to icons, the pages show as icons after a divider (the nav adds the one after them).
 */
function SidebarGroup({
  label,
  icon: Icon,
  tour,
  children,
  collapsed,
}: Extract<NavEntry, { children: NavLeaf[] }> & { collapsed: boolean }) {
  const { pathname } = useLocation();
  const here = children.some(
    (child) => pathname === child.to || pathname.startsWith(`${child.to}/`),
  );
  const [open, setOpen] = useState(here);
  useEffect(() => {
    if (here) setOpen(true);
  }, [here]);

  if (collapsed) {
    return (
      <div className="space-y-1" data-tour={`nav-${tour}`}>
        <div className="mx-2 my-2 border-t border-zinc-200" />
        {children.map((child) => (
          <SidebarLink key={child.to} collapsed {...child} />
        ))}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-tour={`nav-${tour}`}
        // Folded on one of its pages, the row itself shows where you are.
        className={cn(navItemClass(here && !open), "w-full")}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[1.3rem] space-y-0.5 border-l border-zinc-200 pl-2.5">
          {children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              data-tour={`nav-${child.tour}`}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                  isActive
                    ? "bg-zinc-200/70 font-semibold text-zinc-900"
                    : "font-medium text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900",
                )
              }
            >
              <span className="truncate">{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
  tour,
  badge,
  count,
}: {
  to: string;
  label: string;
  icon: typeof CalendarDays;
  end?: boolean;
  collapsed: boolean;
  /** Where the guided tour points at it: nav-<tour>. */
  tour: string;
  badge?: string;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      data-tour={`nav-${tour}`}
      title={collapsed ? [label, badge].filter(Boolean).join(" · ") : badge}
      className={({ isActive }) =>
        cn(navItemClass(isActive), "relative", collapsed && "justify-center px-0")
      }
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
      {badge &&
        (collapsed ? (
          <span
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500"
            aria-hidden
          />
        ) : (
          <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-800 tabular-nums">
            {count}
          </span>
        ))}
      {badge && <span className="sr-only">{badge}</span>}
    </NavLink>
  );
}

/** Shows the business being managed and lets you jump to another one. */
/** With more than one business to pick from, the switcher can be searched. */
const SEARCH_FROM = 2;

function BusinessSwitcher({
  businesses,
  current,
  collapsed,
  isOwner,
}: {
  businesses: Business[];
  current: Business | undefined;
  collapsed: boolean;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const canSearch = businesses.length >= SEARCH_FROM;
  const needle = searchable(query.trim());
  const shown = needle
    ? businesses.filter((business) => searchable(business.name).includes(needle))
    : businesses;

  // Each time it opens, the search starts empty.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (businesses.length === 0 && !isOwner) return null;
  const label = current?.name ?? t("nav.chooseBusiness");

  return (
    <div ref={ref} className="relative" data-tour="business-switcher">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        // The whole name on hover, for long ones cut short.
        title={label}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
          collapsed
            ? "justify-center hover:bg-zinc-200/40"
            : "bg-white shadow-xs ring-1 ring-zinc-200 hover:bg-zinc-50",
        )}
      >
        <BusinessAvatar name={current?.name} logoUrl={current?.logoUrl} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
              {label}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-60 rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200",
            collapsed ? "left-full top-0 ml-2" : "left-0",
          )}
        >
          {canSearch && (
            <div className="relative mb-1 border-b border-zinc-100 pb-1">
              <Search
                className="pointer-events-none absolute top-[calc(50%-2px)] left-2.5 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <input
                type="search"
                // biome-ignore lint/a11y/noAutofocus: the menu opens to search it.
                autoFocus={window.matchMedia("(pointer: fine)").matches}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  // Enter opens the first business found.
                  if (event.key === "Enter" && shown[0]) {
                    navigate(businessPath(shown[0]));
                    setOpen(false);
                  }
                }}
                placeholder={t("nav.searchBusiness")}
                aria-label={t("nav.searchBusiness")}
                className="h-9 w-full rounded-lg bg-zinc-50 pr-2 pl-8 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:bg-white focus:ring-1 focus:ring-brand-300 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-2 py-3 text-center text-[13px] text-zinc-500">
                {t("nav.noBusinessMatches")}
              </p>
            )}
            {shown.map((business) => (
              <Link
                key={business.id}
                to={businessPath(business)}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                <BusinessAvatar name={business.name} logoUrl={business.logoUrl} small />
                <span className="min-w-0 flex-1 truncate">{business.name}</span>
                {business.id === current?.id && (
                  <Check className="size-4 text-brand-600" aria-hidden />
                )}
              </Link>
            ))}
          </div>
          {isOwner && (
            <div className="mt-1 border-t border-zinc-100 pt-1">
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                <Building2 className="size-4 text-zinc-400" aria-hidden />
                {t("nav.allBusinesses")}
              </Link>
              <Link
                to="/admin/businesses/new"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                <Plus className="size-4" aria-hidden />
                {t("businesses.new")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The business's logo, or the first letter of its name until it uploads one. */
function BusinessAvatar({
  name,
  logoUrl,
  small,
}: {
  name?: string;
  logoUrl?: string | null;
  small?: boolean;
}): ReactNode {
  const size = small ? "size-6" : "size-8";
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={cn(size, "shrink-0 rounded-md bg-white object-cover ring-1 ring-zinc-200")}
      />
    );
  }
  return (
    <span
      className={cn(
        size,
        "grid shrink-0 place-items-center rounded-md bg-zinc-900 font-semibold text-white",
        small ? "text-xs" : "text-sm",
      )}
    >
      {name ? name.charAt(0).toUpperCase() : <Building2 className="size-4" aria-hidden />}
    </span>
  );
}

/** The signed-in user, for pages inside the admin layout. */
export function useAdminUser() {
  return useOutletContext<User>();
}

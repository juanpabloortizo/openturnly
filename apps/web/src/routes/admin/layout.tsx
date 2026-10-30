import {
  Building2,
  CalendarDays,
  ChartColumn,
  Check,
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
  Settings,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router";
import { Logo, LogoMark } from "../../components/brand.tsx";
import { Spinner } from "../../components/ui.tsx";
import type { Business, User } from "../../lib/api.ts";
import { useBusinesses } from "../../lib/businesses.ts";
import { cn } from "../../lib/cn.ts";
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
  const { businessId } = useParams();
  const businesses = useBusinesses();
  const current = businesses.data?.find((business) => business.id === businessId);
  const base = businessId ? `/admin/businesses/${businessId}` : null;

  // Professionals only work with their own agenda.
  const role = current?.access.role;
  const manages = role !== "professional";
  // Grouped like the work: selling, products, numbers, then setting the business up.
  type NavGroup = "sales" | "admin";
  const businessNav: {
    to: string;
    label: string;
    icon: typeof CalendarDays;
    tour: string;
    end?: boolean;
    group?: NavGroup;
  }[] = base
    ? [
        { to: base, label: t("nav.agenda"), icon: CalendarDays, end: true, tour: "agenda" },
        ...(manages
          ? [
              {
                to: `${base}/customers`,
                label: t("nav.customers"),
                icon: Contact,
                tour: "customers",
              },
              {
                to: `${base}/reports`,
                label: t("nav.reports"),
                icon: ChartColumn,
                tour: "reports",
              },
              {
                to: `${base}/sales`,
                label: t("nav.sales"),
                icon: Receipt,
                tour: "sales",
                group: "sales" as const,
              },
              {
                to: `${base}/cash`,
                label: t("nav.cash"),
                icon: Wallet,
                tour: "cash",
                group: "sales" as const,
              },
              {
                to: `${base}/gift-cards`,
                label: t("nav.giftCards"),
                icon: Gift,
                tour: "gift-cards",
                group: "sales" as const,
              },
              {
                to: `${base}/inventory`,
                label: t("nav.inventory"),
                icon: Package,
                tour: "inventory",
                group: "sales" as const,
              },
              {
                to: `${base}/services`,
                label: t("nav.services"),
                icon: Scissors,
                tour: "services",
                group: "admin" as const,
              },
              {
                to: `${base}/professionals`,
                label: t("nav.professionals"),
                icon: Users,
                tour: "professionals",
                group: "admin" as const,
              },
              {
                to: `${base}/locations`,
                label: t("nav.locations"),
                icon: MapPin,
                tour: "locations",
                group: "admin" as const,
              },
              {
                to: `${base}/hours`,
                label: t("nav.hours"),
                icon: Clock3,
                tour: "hours",
                group: "admin" as const,
              },
              {
                to: `${base}/settings`,
                label: t("nav.settings"),
                icon: Settings,
                tour: "settings",
                group: "admin" as const,
              },
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
        {businessNav.map(({ group, ...item }, index) => (
          <div key={item.to}>
            {group && businessNav[index - 1]?.group !== group && (
              <div
                className={cn(
                  "pt-4 pb-1",
                  collapsed
                    ? "mx-2 border-t border-zinc-200"
                    : "px-3 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase",
                )}
              >
                {!collapsed && t(`nav.groups.${group}`)}
              </div>
            )}
            <SidebarLink collapsed={collapsed} {...item} />
          </div>
        ))}
      </nav>

      <AccountMenu
        user={user}
        collapsed={collapsed}
        roleLabel={
          user.role === "owner"
            ? t("nav.owner")
            : role === "admin" || role === "professional"
              ? t(`access.roles.${role}`)
              : null
        }
      />
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

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
  tour,
}: {
  to: string;
  label: string;
  icon: typeof CalendarDays;
  end?: boolean;
  collapsed: boolean;
  /** Where the guided tour points at it: nav-<tour>. */
  tour: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      data-tour={`nav-${tour}`}
      title={collapsed ? label : undefined}
      className={({ isActive }) => cn(navItemClass(isActive), collapsed && "justify-center px-0")}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

/** Shows the business being managed and lets you jump to another one. */
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        title={collapsed ? label : undefined}
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
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-zinc-400">{t("nav.business")}</span>
              <span className="block truncate text-sm font-medium text-zinc-900">{label}</span>
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
          <div className="max-h-72 overflow-y-auto">
            {businesses.map((business) => (
              <Link
                key={business.id}
                to={`/admin/businesses/${business.id}`}
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

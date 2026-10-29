import { useTranslation } from "react-i18next";
import { createBrowserRouter, Link } from "react-router";
import { buttonClass } from "./components/ui.tsx";
import { PublicBookingPage } from "./routes/public-page.tsx";

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
      <Link to="/" className={buttonClass({ variant: "secondary" })}>
        {t("notFound.home")}
      </Link>
    </div>
  );
}

// The admin panel loads in its own chunk so the public booking page stays light on phones.
const admin = () => import("./routes/admin/index.ts");
const page = (name: keyof Awaited<ReturnType<typeof admin>>) => async () => ({
  Component: (await admin())[name],
});

export const router = createBrowserRouter([
  { path: "/", lazy: page("HomeRedirect") },
  { path: "/setup", lazy: page("SetupPage") },
  { path: "/login", lazy: page("LoginPage") },
  { path: "/invite/:token", lazy: page("InvitePage") },
  {
    path: "/admin",
    lazy: page("AdminLayout"),
    children: [
      { index: true, lazy: page("BusinessesPage") },
      { path: "businesses/new", lazy: page("NewBusinessPage") },
      {
        path: "businesses/:businessId",
        lazy: page("BusinessLayout"),
        children: [
          { index: true, lazy: page("AgendaPage") },
          { path: "sales", lazy: page("SalesPage") },
          { path: "gift-cards", lazy: page("GiftCardsPage") },
          { path: "customers", lazy: page("CustomersPage") },
          { path: "locations", lazy: page("LocationsPage") },
          { path: "services", lazy: page("ServicesPage") },
          { path: "professionals", lazy: page("ProfessionalsPage") },
          { path: "hours", lazy: page("HoursPage") },
          { path: "settings", lazy: page("SettingsPage") },
          { path: "automations/:automationId", lazy: page("AutomationBuilderPage") },
          { path: "access", lazy: page("BusinessAccessPage") },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // Must stay last: any other single segment is a business booking page.
  { path: "/:slug/login", lazy: page("BusinessLoginPage") },
  { path: "/:slug", element: <PublicBookingPage /> },
  { path: "*", element: <NotFoundPage /> },
]);

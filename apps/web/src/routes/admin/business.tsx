import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { Alert, Spinner } from "../../components/ui.tsx";
import type { Business, User } from "../../lib/api.ts";
import { useBusiness } from "../../lib/businesses.ts";
import { errorMessage } from "../../lib/forms.ts";
import { useAdminUser } from "./layout.tsx";
import { BusinessTours } from "./tours.tsx";

export type BusinessContext = { business: Business; user: User };

/** Loads the business in the URL for the pages of the sidebar (agenda, services…). */
export function BusinessLayout() {
  const { t } = useTranslation();
  const user = useAdminUser();
  const { businessId = "" } = useParams();
  const business = useBusiness(businessId);
  const { pathname } = useLocation();

  if (business.isPending) return <Spinner />;
  if (business.isError) return <Alert>{errorMessage(t, business.error)}</Alert>;
  // Professionals only have the agenda; any other page sends them back to it.
  const agenda = `/admin/businesses/${businessId}`;
  if (business.data.access.role === "professional" && pathname.replace(/\/$/, "") !== agenda) {
    return <Navigate to={agenda} replace />;
  }

  return (
    <>
      <Outlet context={{ business: business.data, user } satisfies BusinessContext} />
      <BusinessTours business={business.data} user={user} />
    </>
  );
}

export function useBusinessContext() {
  return useOutletContext<BusinessContext>();
}

export function publicUrl(slug: string) {
  return `${window.location.origin}/${slug}`;
}

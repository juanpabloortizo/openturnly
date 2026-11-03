import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { Alert, Spinner } from "../../components/ui.tsx";
import type { Business, User } from "../../lib/api.ts";
import { businessPath, useBusiness, useBusinesses } from "../../lib/businesses.ts";
import { errorMessage } from "../../lib/forms.ts";
import { useAdminUser } from "./layout.tsx";
import { BusinessTours } from "./tours.tsx";

export type BusinessContext = { business: Business; user: User };

/** Loads the business in the URL (/admin/<short id>) for the pages of the sidebar. */
export function BusinessLayout() {
  const { t } = useTranslation();
  const user = useAdminUser();
  const { businessCode = "" } = useParams();
  const businesses = useBusinesses();
  // Found in the user's list, then loaded by id so saving settings updates it everywhere.
  const listed = businesses.data?.find((candidate) => candidate.shortId === businessCode);
  const business = useBusiness(listed?.id ?? "");
  const { pathname } = useLocation();

  if (businesses.isError) return <Alert>{errorMessage(t, businesses.error)}</Alert>;
  // A business created a moment ago may still be on its way into the list.
  if (!listed) {
    return businesses.isPending || businesses.isFetching ? (
      <Spinner />
    ) : (
      <Alert>{t("errors.business_not_found")}</Alert>
    );
  }
  if (business.isPending) return <Spinner />;
  if (business.isError) return <Alert>{errorMessage(t, business.error)}</Alert>;
  // Professionals only have the agenda; any other page sends them back to it.
  const agenda = businessPath(listed);
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

/** Links from before short ids (/admin/businesses/<id>/…) go to the same page today. */
export function LegacyBusinessRedirect() {
  const { businessId, "*": rest = "" } = useParams();
  const { search, hash } = useLocation();
  const businesses = useBusinesses();
  if (businesses.isPending) return <Spinner />;
  const business = businesses.data?.find((candidate) => candidate.id === businessId);
  if (!business) return <Navigate to="/admin" replace />;
  const path = rest ? `${businessPath(business)}/${rest}` : businessPath(business);
  return <Navigate to={`${path}${search}${hash}`} replace />;
}

export function useBusinessContext() {
  return useOutletContext<BusinessContext>();
}

export function publicUrl(slug: string) {
  return `${window.location.origin}/${slug}`;
}

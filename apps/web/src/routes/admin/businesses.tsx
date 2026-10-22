import { ArrowUpRight, ChevronRight, Plus, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router";
import { EmptyState, PageHeader } from "../../components/controls.tsx";
import { type Column, DataTable, IdentityCell } from "../../components/data-table.tsx";
import { Alert, buttonClass, Spinner } from "../../components/ui.tsx";
import type { Business } from "../../lib/api.ts";
import { useBusinesses } from "../../lib/businesses.ts";
import { errorMessage } from "../../lib/forms.ts";
import { publicHost } from "../../lib/locale.ts";
import { useAdminUser } from "./layout.tsx";

export function BusinessesPage() {
  const { t } = useTranslation();
  const user = useAdminUser();
  const navigate = useNavigate();
  const businesses = useBusinesses();
  const isOwner = user.role === "owner";

  if (businesses.isPending) return <Spinner />;
  if (businesses.isError) return <Alert>{errorMessage(t, businesses.error)}</Alert>;

  // A client with a single business goes straight to it.
  const [only] = businesses.data;
  if (!isOwner && only && businesses.data.length === 1) {
    return <Navigate to={`/admin/businesses/${only.id}`} replace />;
  }

  const newButton = isOwner && (
    <Link to="/admin/businesses/new" className={buttonClass()}>
      <Plus className="size-4" aria-hidden />
      {t("businesses.new")}
    </Link>
  );

  const columns: Column<Business>[] = [
    {
      key: "name",
      header: t("businesses.colBusiness"),
      cell: (business) => (
        <IdentityCell initial={business.name} imageUrl={business.logoUrl} title={business.name} />
      ),
    },
    {
      key: "page",
      header: t("businesses.colPage"),
      className: "hidden md:table-cell",
      cell: (business) => (
        <a
          href={`/${business.slug}`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 font-mono text-[13px] whitespace-nowrap text-zinc-600 hover:text-brand-700"
        >
          {publicHost()}
          {business.slug}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      ),
    },
    {
      key: "timezone",
      header: t("businesses.colTimezone"),
      className: "hidden xl:table-cell whitespace-nowrap",
      cell: (business) => (
        <span className="text-zinc-600">{business.timezone.replaceAll("_", " ")}</span>
      ),
    },
    {
      key: "currency",
      header: t("businesses.colCurrency"),
      className: "hidden xl:table-cell",
      cell: (business) => <span className="text-zinc-600">{business.currency}</span>,
    },
    {
      key: "open",
      header: "",
      className: "w-10 text-right",
      cell: () => <ChevronRight className="ml-auto size-4 text-zinc-400" aria-hidden />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("businesses.title")}
        subtitle={isOwner ? t("businesses.subtitleOwner") : t("businesses.subtitleMember")}
        actions={newButton}
      />
      {businesses.data.length === 0 ? (
        <EmptyState
          icon={<Store className="size-5" aria-hidden />}
          title={t("businesses.emptyTitle")}
          body={isOwner ? t("businesses.emptyOwner") : t("businesses.emptyMember")}
          action={newButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={businesses.data}
          rowKey={(business) => business.id}
          onRowClick={(business) => navigate(`/admin/businesses/${business.id}`)}
          searchPlaceholder={t("businesses.search")}
          matches={(business, query) =>
            business.name.toLowerCase().includes(query) || business.slug.includes(query)
          }
          empty={t("businesses.emptyTitle")}
        />
      )}
    </>
  );
}

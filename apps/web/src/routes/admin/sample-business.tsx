import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, buttonClass } from "../../components/ui.tsx";
import type { Business } from "../../lib/api.ts";
import { businessPath, useCreateSampleBusiness, useDeleteBusiness } from "../../lib/businesses.ts";
import { errorMessage } from "../../lib/forms.ts";
import { browserTimeZone, guessCurrency } from "../../lib/locale.ts";

/** Creates the sample business in the owner's region and language, and opens it. */
export function useStartSample() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSampleBusiness();
  const timezone = browserTimeZone();
  const start = () =>
    create.mutate(
      {
        timezone,
        currency: guessCurrency(timezone),
        locale: i18n.resolvedLanguage === "en" ? "en" : "es",
      },
      {
        onSuccess: (business) => navigate(businessPath(business)),
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  return { start, pending: create.isPending };
}

/** On the new business form: try OpenTurnly with made-up data before setting up a real one. */
export function SampleOffer() {
  const { t } = useTranslation();
  const sample = useStartSample();
  return (
    <div className="flex max-w-3xl flex-col gap-3 rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3.5 sm:flex-row sm:items-center">
      <FlaskConical className="hidden size-5 shrink-0 text-brand-700 sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{t("sample.offerTitle")}</p>
        <p className="mt-0.5 text-[13px] text-zinc-600">{t("sample.offerBody")}</p>
      </div>
      <Button variant="secondary" onClick={sample.start} loading={sample.pending}>
        {t("sample.create")}
      </Button>
    </div>
  );
}

/** Over every page of the sample business, so nobody takes its data for real. */
export function SampleBanner({ business, isOwner }: { business: Business; isOwner: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const remove = useDeleteBusiness(business.id);

  const ask = async () => {
    const ok = await confirm({
      title: t("sample.removeTitle"),
      description: t("sample.removeBody"),
      confirmLabel: t("sample.remove"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("sample.removed"));
        navigate("/admin", { replace: true });
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <div
      data-sample-banner
      className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center"
    >
      <FlaskConical className="hidden size-5 shrink-0 text-amber-700 sm:block" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-amber-900">
        <span className="font-medium">{t("sample.bannerTitle")}</span> {t("sample.bannerBody")}
      </p>
      {isOwner && (
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={ask} loading={remove.isPending}>
            {t("sample.remove")}
          </Button>
          <Link
            to="/admin/businesses/new"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("sample.createOwn")}
          </Link>
        </div>
      )}
    </div>
  );
}

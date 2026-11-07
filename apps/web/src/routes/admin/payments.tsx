import { formatPrice, paymentConnectionSchema } from "@openturnly/core";
import { CreditCard } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { PasswordInput, SettingsCard } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, CopyField, Field, Spinner } from "../../components/ui.tsx";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { usePaymentMutations, usePayments } from "../../lib/payments.ts";
import { useBusinessContext } from "./business.tsx";

/** Settings → Payments: the Mercado Pago account customers pay into from the booking page. */
export function PaymentsTab() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const payments = usePayments(business.id);
  const { connect, disconnect } = usePaymentMutations(business.id);
  const confirm = useConfirm();
  const [accessToken, setAccessToken] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  if (payments.isPending) return <Spinner />;
  if (payments.isError) return <Alert>{errorMessage(t, payments.error)}</Alert>;
  const { connection, webhookUrl, refunds } = payments.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(paymentConnectionSchema, { accessToken });
    setErrors(result.errors ?? {});
    if (!result.data) return;
    connect.mutate(result.data, {
      onSuccess: () => {
        setAccessToken("");
        toast.success(t("paymentSettings.connected"));
      },
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("paymentSettings.disconnectTitle"),
      description: t("paymentSettings.disconnectBody"),
      confirmLabel: t("paymentSettings.disconnect"),
      tone: "danger",
    });
    if (!ok) return;
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success(t("paymentSettings.disconnected")),
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  return (
    <div className="space-y-5">
      <SettingsCard
        title={t("paymentSettings.title")}
        description={t("paymentSettings.description")}
      >
        {connection ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
                <CreditCard className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900">
                  {connection.accountName ?? connection.accountId}
                </p>
                <p className="text-[13px] text-zinc-500">
                  {t("paymentSettings.accountId", { id: connection.accountId })}
                </p>
              </div>
              <Badge tone={connection.testMode ? "warning" : "success"}>
                {t(connection.testMode ? "paymentSettings.test" : "paymentSettings.live")}
              </Badge>
            </div>
            <Button variant="secondary" loading={disconnect.isPending} onClick={remove}>
              {t("paymentSettings.disconnect")}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            {connect.isError && <Alert>{errorMessage(t, connect.error)}</Alert>}
            <Field
              label={t("paymentSettings.token")}
              hint={t("paymentSettings.tokenHint")}
              error={fieldMessage(t, "accessToken", errors.accessToken)}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="off"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={connect.isPending}>
              {t("paymentSettings.connect")}
            </Button>
          </form>
        )}
      </SettingsCard>
      {connection && (
        <>
          <SettingsCard
            title={t("paymentSettings.nextTitle")}
            description={t("paymentSettings.nextBody")}
          >
            <Link
              to="../services"
              relative="path"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {t("paymentSettings.nextLink")}
            </Link>
          </SettingsCard>
          <SettingsCard
            title={t("paymentSettings.webhookTitle")}
            description={t("paymentSettings.webhookHint")}
          >
            <CopyField label={t("paymentSettings.webhook")} value={webhookUrl} />
          </SettingsCard>
        </>
      )}
      {refunds.length > 0 && (
        <SettingsCard
          title={t("paymentSettings.refundsTitle")}
          description={t("paymentSettings.refundsDescription")}
        >
          <ul className="divide-y divide-zinc-100">
            {refunds.map((refund) => (
              <li key={refund.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {[refund.firstName, refund.lastName].filter(Boolean).join(" ") || refund.code}
                  </p>
                  <p className="text-[13px] text-zinc-500">
                    {formatPrice(refund.amount, refund.currency)}
                  </p>
                </div>
                <Badge tone={refund.status === "refunded" ? "success" : "warning"}>
                  {t(
                    refund.status === "refunded"
                      ? "paymentSettings.refundDone"
                      : "paymentSettings.refundPending",
                  )}
                </Badge>
              </li>
            ))}
          </ul>
          {refunds.some((refund) => refund.status === "refunding") && (
            <p className="mt-2 text-[13px] text-zinc-500">
              {t("paymentSettings.refundPendingHint")}
            </p>
          )}
        </SettingsCard>
      )}
    </div>
  );
}

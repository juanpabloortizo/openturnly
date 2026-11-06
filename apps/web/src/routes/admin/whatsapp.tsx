import { WHATSAPP_VARIABLE_DATA, whatsappConnectionSchema } from "@openturnly/core";
import { Plug, Send, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { PasswordInput, SettingsCard } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import {
  Alert,
  Badge,
  Button,
  CopyField,
  Field,
  Input,
  Select,
  Spinner,
} from "../../components/ui.tsx";
import type { WhatsappConnection, WhatsappOverview, WhatsappTemplate } from "../../lib/api.ts";
import { useWhatsapp, useWhatsappMutations, useWhatsappTemplates } from "../../lib/businesses.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

const STATUS_TONES = { connected: "success", error: "danger", disconnected: "neutral" } as const;
const TEMPLATE_TONES: Record<string, "success" | "danger" | "neutral"> = {
  APPROVED: "success",
  REJECTED: "danger",
  PAUSED: "danger",
  DISABLED: "danger",
};

/** The values to fill a template with, to test it: the ready-made names know their data. */
function testVariables(template: WhatsappTemplate) {
  return template.variables.map((name) => ({
    name,
    value: WHATSAPP_VARIABLE_DATA[name] ?? "Test",
  }));
}

/** Settings → WhatsApp: which number the business's messages go out on. */
export function WhatsappTab() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const whatsapp = useWhatsapp(business.id);
  const [ownForm, setOwnForm] = useState(false);

  if (whatsapp.isPending) return <Spinner />;
  if (whatsapp.isError) return <Alert>{errorMessage(t, whatsapp.error)}</Alert>;
  const overview = whatsapp.data;
  const showForm = ownForm || overview.connection !== null || overview.default === null;

  return (
    <section className="space-y-4">
      <SenderCard overview={overview} />
      {overview.default && !showForm && (
        <div>
          <Button variant="secondary" onClick={() => setOwnForm(true)}>
            <Plug className="size-4" aria-hidden />
            {t("whatsapp.useOwn")}
          </Button>
        </div>
      )}
      {showForm && <OwnNumberCard connection={overview.connection} overview={overview} />}
      {overview.connection && <WebhookCard connection={overview.connection} />}
      {overview.active && <TemplatesCard overview={overview} />}
    </section>
  );
}

/** Says which number is sending right now, in plain words. */
function SenderCard({ overview }: { overview: WhatsappOverview }) {
  const { t } = useTranslation();
  const own = overview.connection;
  const number = (profile: { phoneNumber: string | null; displayName: string | null }) =>
    [profile.displayName, profile.phoneNumber].filter(Boolean).join(" · ") ||
    t("whatsapp.unknownNumber");
  return (
    <SettingsCard
      title={t("whatsapp.title")}
      description={
        overview.active === "own" && own
          ? t("whatsapp.sendingOwn", { number: number(own) })
          : overview.active === "default" && overview.default
            ? t("whatsapp.sendingDefault", { number: number(overview.default) })
            : t("whatsapp.notSending")
      }
      action={
        <Badge tone={overview.active ? "success" : "neutral"}>
          {t(overview.active ? "whatsapp.active" : "whatsapp.inactive")}
        </Badge>
      }
    />
  );
}

/** The credentials of the business's own number, as WhatsApp's developer panel shows them. */
function OwnNumberCard({
  connection,
  overview,
}: {
  connection: WhatsappConnection | null;
  overview: WhatsappOverview;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { save, connect, remove } = useWhatsappMutations(business.id);
  const confirm = useConfirm();
  const [phoneNumberId, setPhoneNumberId] = useState(connection?.phoneNumberId ?? "");
  const [wabaId, setWabaId] = useState(connection?.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const error = (field: string) => fieldMessage(t, field, errors[field]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = validate(whatsappConnectionSchema, {
      phoneNumberId,
      wabaId,
      accessToken,
      appSecret,
    });
    setErrors(input.errors ?? {});
    if (!input.data) return;
    save.mutate(input.data, {
      onSuccess: () => {
        setAccessToken("");
        setAppSecret("");
        // Saved credentials are worth nothing until WhatsApp accepts them.
        connect.mutate(undefined, {
          onSuccess: ({ connection: saved }) => {
            if (saved?.status === "connected") toast.success(t("whatsapp.connected"));
            else toast.error(saved?.lastError ?? t("whatsapp.notConnected"));
          },
          onError: (failure) => toast.error(errorMessage(t, failure)),
        });
      },
      onError: (failure) => {
        setErrors(apiFieldErrors(failure));
        toast.error(errorMessage(t, failure));
      },
    });
  };

  const forget = async () => {
    const ok = await confirm({
      title: t("whatsapp.removeTitle"),
      description: overview.default ? t("whatsapp.removeToDefault") : t("whatsapp.removeBody"),
      confirmLabel: t("whatsapp.remove"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => toast.success(t("whatsapp.removed")),
      onError: (failure) => toast.error(errorMessage(t, failure)),
    });
  };

  return (
    <SettingsCard
      title={t("whatsapp.ownTitle")}
      description={t("whatsapp.ownHint")}
      action={
        connection && (
          <Badge tone={STATUS_TONES[connection.status]}>
            {t(`whatsapp.status.${connection.status}`)}
          </Badge>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {connection?.lastError && <Alert>{connection.lastError}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("whatsapp.phoneNumberId")} error={error("phoneNumberId")}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={phoneNumberId}
                onChange={(event) => setPhoneNumberId(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("whatsapp.wabaId")} hint={t("whatsapp.wabaHint")} error={error("wabaId")}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={wabaId}
                onChange={(event) => setWabaId(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("whatsapp.accessToken")}
            hint={connection?.hasAccessToken ? t("whatsapp.keepSaved") : undefined}
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
          <Field
            label={t("whatsapp.appSecret")}
            hint={connection?.hasAppSecret ? t("whatsapp.keepSaved") : undefined}
          >
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="off"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="submit" disabled={save.isPending || connect.isPending}>
            {t("whatsapp.saveConnect")}
          </Button>
          {connection && (
            <Button
              type="button"
              variant="ghost"
              className="text-zinc-500 hover:text-red-600"
              onClick={forget}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("whatsapp.remove")}
            </Button>
          )}
        </div>
      </form>
    </SettingsCard>
  );
}

/** What to paste into the WhatsApp app, so delivery updates reach this business. */
function WebhookCard({ connection }: { connection: WhatsappConnection }) {
  const { t } = useTranslation();
  return (
    <SettingsCard title={t("whatsapp.webhookTitle")} description={t("whatsapp.webhookHint")}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-zinc-800">{t("whatsapp.webhookUrl")}</p>
          <CopyField value={connection.webhookUrl} label={t("whatsapp.webhookUrl")} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-zinc-800">{t("whatsapp.verifyToken")}</p>
          <CopyField value={connection.webhookVerifyToken} label={t("whatsapp.verifyToken")} />
        </div>
      </div>
    </SettingsCard>
  );
}

/** The number's templates, and a test message with one of them. */
function TemplatesCard({ overview }: { overview: WhatsappOverview }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const templates = useWhatsappTemplates(business.id, true);
  const { prepareTemplates, test } = useWhatsappMutations(business.id);
  const [choice, setChoice] = useState("");
  const [phone, setPhone] = useState(business.phone ?? "");
  const list = templates.data?.templates ?? [];
  const approved = list.filter((item) => item.status === "APPROVED" && item.usable);
  const selected =
    approved.find((item) => `${item.name}:${item.language}` === choice) ?? approved[0];

  const prepare = () =>
    prepareTemplates.mutate(undefined, {
      onSuccess: ({ created, error }) => {
        if (error) toast.error(error);
        else toast.success(t("whatsapp.templatesSent", { count: created }));
      },
      onError: (failure) => toast.error(errorMessage(t, failure)),
    });

  const sendTest = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    test.mutate(
      {
        phone,
        template: selected.name,
        language: selected.language,
        variables: testVariables(selected),
      },
      {
        onSuccess: (result) => {
          if (result.ok) toast.success(t("whatsapp.testSent"));
          else toast.error(result.error ?? t("whatsapp.testFailed"));
        },
        onError: (failure) => toast.error(errorMessage(t, failure)),
      },
    );
  };

  return (
    <SettingsCard
      title={t("whatsapp.templatesTitle")}
      description={t("whatsapp.templatesHint")}
      action={
        overview.active === "own" && (
          <Button variant="secondary" disabled={prepareTemplates.isPending} onClick={prepare}>
            {t("whatsapp.prepareTemplates")}
          </Button>
        )
      }
    >
      {templates.isPending ? (
        <Spinner />
      ) : templates.isError ? (
        <Alert>{errorMessage(t, templates.error)}</Alert>
      ) : templates.data.error ? (
        <Alert>
          {templates.data.error === "whatsapp_account_missing"
            ? t("whatsapp.accountMissing")
            : templates.data.error}
        </Alert>
      ) : list.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("whatsapp.noTemplates")}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {list.map((item) => (
            <li
              key={`${item.name}:${item.language}`}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="font-mono text-[13px] text-zinc-900">
                  {item.name} <span className="text-zinc-400">· {item.language}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-zinc-500">{item.body}</p>
              </div>
              <Badge tone={TEMPLATE_TONES[item.status] ?? "neutral"}>{item.status}</Badge>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <form onSubmit={sendTest} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label={t("whatsapp.testTemplate")}>
            {(props) => (
              <Select
                {...props}
                value={`${selected.name}:${selected.language}`}
                onChange={(event) => setChoice(event.target.value)}
              >
                {approved.map((item) => (
                  <option
                    key={`${item.name}:${item.language}`}
                    value={`${item.name}:${item.language}`}
                  >
                    {item.name} ({item.language})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("whatsapp.testPhone")}>
            {(props) => (
              <Input
                {...props}
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={test.isPending || !phone.trim()}>
            <Send className="size-4" aria-hidden />
            {t("whatsapp.sendTest")}
          </Button>
        </form>
      )}
    </SettingsCard>
  );
}

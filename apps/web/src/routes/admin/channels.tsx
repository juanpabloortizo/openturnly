import {
  EMAIL_PROVIDERS,
  EMAIL_TEMPLATES,
  type EmailProvider,
  emailConnectionSchema,
  WHATSAPP_VARIABLE_DATA,
  whatsappConnectionSchema,
} from "@openturnly/core";
import type { TFunction } from "i18next";
import {
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  Send,
  Trash2,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, PageHeader, PasswordInput, SettingsCard } from "../../components/controls.tsx";
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
import type {
  EmailConnection,
  EmailOverview,
  WhatsappConnection,
  WhatsappOverview,
  WhatsappTemplate,
} from "../../lib/api.ts";
import {
  useEmail,
  useEmailMutations,
  useWhatsapp,
  useWhatsappMutations,
  useWhatsappTemplates,
} from "../../lib/channels.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { useMe } from "../../lib/session.ts";

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

/** Its own page, for whoever runs the install. */
export function ChannelsPage() {
  const { t } = useTranslation();
  const me = useMe();
  if (!me.data) return <Spinner />;
  if (me.data.role !== "owner") return <Navigate to="/admin/account" replace />;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title={t("channels.title")} subtitle={t("channels.subtitle")} />
      <ChannelsSection />
    </div>
  );
}

type Connectable = "whatsapp" | "email";

/** How the install reaches customers: every business sends through what's set here. */
export function ChannelsSection() {
  const { t } = useTranslation();
  const whatsapp = useWhatsapp();
  const email = useEmail();
  const [open, setOpen] = useState<Connectable | null>(null);
  const number = whatsapp.data ? whatsappSummary(t, whatsapp.data) : "";
  const address = email.data ? emailSummary(t, email.data) : "";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <ChannelCard
        icon={MessageCircle}
        title={t("channels.tabs.whatsapp")}
        active={Boolean(whatsapp.data?.active)}
        detail={number}
        onOpen={() => setOpen("whatsapp")}
      />
      <ChannelCard
        icon={Mail}
        title={t("channels.tabs.email")}
        active={Boolean(email.data?.active)}
        detail={address}
        onOpen={() => setOpen("email")}
      />
      <ChannelCard
        icon={MessageSquare}
        title={t("channels.tabs.sms")}
        detail={t("channels.smsSoon")}
      />

      <Modal
        open={open === "whatsapp"}
        onClose={() => setOpen(null)}
        title={t("channels.tabs.whatsapp")}
        description={number}
        wide
      >
        <WhatsappChannel />
      </Modal>
      <Modal
        open={open === "email"}
        onClose={() => setOpen(null)}
        title={t("channels.tabs.email")}
        description={address}
        wide
      >
        <EmailChannel />
      </Modal>
    </div>
  );
}

/** One channel at a glance. Without `onOpen` it isn't available yet. */
function ChannelCard({
  icon: Icon,
  title,
  detail,
  active,
  onOpen,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  active?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-zinc-100 text-zinc-600">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <Badge tone={active ? "success" : "neutral"}>
          {t(onOpen ? (active ? "whatsapp.active" : "whatsapp.inactive") : "channels.soon")}
        </Badge>
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-[13px] break-words text-zinc-500">{detail}</p>
      </div>
      {onOpen && (
        <Button variant="secondary" onClick={onOpen}>
          {t("channels.configure")}
        </Button>
      )}
    </section>
  );
}

/** Which number is sending right now, in plain words. */
function whatsappSummary(t: TFunction, overview: WhatsappOverview) {
  const number = (profile: { phoneNumber: string | null; displayName: string | null }) =>
    [profile.displayName, profile.phoneNumber].filter(Boolean).join(" · ") ||
    t("whatsapp.unknownNumber");
  if (overview.active === "own" && overview.connection) {
    return t("whatsapp.sendingOwn", { number: number(overview.connection) });
  }
  if (overview.active === "default" && overview.default) {
    return t("whatsapp.sendingDefault", { number: number(overview.default) });
  }
  return t("whatsapp.notSending");
}

/** Which address is sending right now, in plain words. */
function emailSummary(t: TFunction, overview: EmailOverview) {
  const own = overview.connection?.fromEmail;
  if (overview.active === "own" && own) return t("email.sendingOwn", { address: own });
  if (overview.active === "default" && overview.default) {
    return t("email.sendingDefault", { address: overview.default });
  }
  return t("email.notSending");
}

function WhatsappChannel() {
  const { t } = useTranslation();
  const whatsapp = useWhatsapp();
  const [ownForm, setOwnForm] = useState(false);

  if (whatsapp.isPending) return <Spinner />;
  if (whatsapp.isError) return <Alert>{errorMessage(t, whatsapp.error)}</Alert>;
  const overview = whatsapp.data;
  const showForm = ownForm || overview.connection !== null || overview.default === null;

  return (
    <section className="space-y-4">
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

/** The credentials of the install's number, as WhatsApp's developer panel shows them. */
function OwnNumberCard({
  connection,
  overview,
}: {
  connection: WhatsappConnection | null;
  overview: WhatsappOverview;
}) {
  const { t } = useTranslation();
  const { save, connect, remove } = useWhatsappMutations();
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
  const templates = useWhatsappTemplates();
  const { prepareTemplates, test } = useWhatsappMutations();
  const [choice, setChoice] = useState("");
  const [phone, setPhone] = useState("");
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

const EMAIL_FAILURES = ["email_login", "email_unreachable", "internal_address", "timeout"] as const;

/** A failed connection in words; anything else is the server's own answer. */
function useEmailFailure() {
  const { t } = useTranslation();
  return (error: string | null) =>
    (EMAIL_FAILURES as readonly (string | null)[]).includes(error)
      ? t(`email.failures.${error as (typeof EMAIL_FAILURES)[number]}`)
      : error;
}

function EmailChannel() {
  const { t } = useTranslation();
  const email = useEmail();
  const [ownForm, setOwnForm] = useState(false);

  if (email.isPending) return <Spinner />;
  if (email.isError) return <Alert>{errorMessage(t, email.error)}</Alert>;
  const overview = email.data;
  const showForm = ownForm || overview.connection !== null || overview.default === null;

  return (
    <section className="space-y-4">
      {overview.default && !showForm && (
        <div>
          <Button variant="secondary" onClick={() => setOwnForm(true)}>
            <Plug className="size-4" aria-hidden />
            {t("email.useOwn")}
          </Button>
        </div>
      )}
      {showForm && <OwnEmailCard connection={overview.connection} overview={overview} />}
      {overview.active && <EmailTestCard />}
    </section>
  );
}

/** The account's SMTP details: choosing a provider fills in its server. */
function OwnEmailCard({
  connection,
  overview,
}: {
  connection: EmailConnection | null;
  overview: EmailOverview;
}) {
  const { t } = useTranslation();
  const { save, connect, remove } = useEmailMutations();
  const confirm = useConfirm();
  const failure = useEmailFailure();
  const [provider, setProvider] = useState<EmailProvider>(
    (connection?.provider as EmailProvider | undefined) ?? "resend",
  );
  const preset = EMAIL_PROVIDERS.find((item) => item.id === provider);
  const [host, setHost] = useState<string>(connection?.host ?? preset?.host ?? "");
  const [port, setPort] = useState(String(connection?.port ?? preset?.port ?? 587));
  const [username, setUsername] = useState<string>(connection?.username ?? preset?.username ?? "");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState(connection?.fromEmail ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const error = (field: string) => fieldMessage(t, field, errors[field]);

  const choose = (value: EmailProvider) => {
    const chosen = EMAIL_PROVIDERS.find((item) => item.id === value);
    setProvider(value);
    setHost(chosen?.host ?? "");
    setPort(String(chosen?.port ?? 587));
    setUsername(chosen?.username ?? "");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = validate(emailConnectionSchema, {
      provider,
      host,
      port: Number(port),
      username,
      password,
      fromEmail,
    });
    setErrors(input.errors ?? {});
    if (!input.data) return;
    save.mutate(input.data, {
      onSuccess: () => {
        setPassword("");
        // Saved details are worth nothing until the server accepts them.
        connect.mutate(undefined, {
          onSuccess: ({ connection: saved }) => {
            if (saved?.status === "connected") toast.success(t("email.connected"));
            else toast.error(failure(saved?.lastError ?? null) ?? t("email.notConnected"));
          },
          onError: (problem) => toast.error(errorMessage(t, problem)),
        });
      },
      onError: (problem) => {
        setErrors(apiFieldErrors(problem));
        toast.error(errorMessage(t, problem));
      },
    });
  };

  const forget = async () => {
    const ok = await confirm({
      title: t("email.removeTitle"),
      description: overview.default ? t("email.removeToDefault") : t("email.removeBody"),
      confirmLabel: t("email.remove"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => toast.success(t("email.removed")),
      onError: (problem) => toast.error(errorMessage(t, problem)),
    });
  };

  return (
    <SettingsCard
      title={t("email.ownTitle")}
      description={t("email.ownHint")}
      action={
        connection && (
          <Badge tone={STATUS_TONES[connection.status]}>
            {t(`whatsapp.status.${connection.status}`)}
          </Badge>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {connection?.lastError && <Alert>{failure(connection.lastError)}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("email.provider")}>
            {(props) => (
              <Select
                {...props}
                value={provider}
                onChange={(event) => choose(event.target.value as EmailProvider)}
              >
                {EMAIL_PROVIDERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(`email.providers.${item.id}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("email.fromEmail")} hint={t("email.fromHint")} error={error("fromEmail")}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="off"
                value={fromEmail}
                onChange={(event) => setFromEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("email.host")} error={error("host")}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={host}
                onChange={(event) => setHost(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("email.port")} error={error("port")}>
            {(props) => (
              <Select {...props} value={port} onChange={(event) => setPort(event.target.value)}>
                {[465, 587, 2465, 2587].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("email.username")} error={error("username")}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("email.password")}
            hint={connection?.hasPassword ? t("whatsapp.keepSaved") : undefined}
          >
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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
              {t("email.remove")}
            </Button>
          )}
        </div>
      </form>
    </SettingsCard>
  );
}

/** Sends one ready-made email with example data. */
function EmailTestCard() {
  const { t, i18n } = useTranslation();
  const { test } = useEmailMutations();
  const failure = useEmailFailure();
  const [to, setTo] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    const [template] = EMAIL_TEMPLATES;
    if (!template) return;
    test.mutate(
      {
        to,
        template: template.name,
        language: i18n.resolvedLanguage === "en" ? "en" : "es",
      },
      {
        onSuccess: (result) => {
          if (result.ok) toast.success(t("email.testSent"));
          else toast.error(failure(result.error) ?? t("email.testFailed"));
        },
        onError: (problem) => toast.error(errorMessage(t, problem)),
      },
    );
  };
  return (
    <SettingsCard title={t("email.testTitle")} description={t("email.testHint")}>
      <form onSubmit={send} className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Field label={t("whatsapp.testPhone")}>
          {(props) => (
            <Input
              {...props}
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={test.isPending || !to.trim()}>
          <Send className="size-4" aria-hidden />
          {t("whatsapp.sendTest")}
        </Button>
      </form>
    </SettingsCard>
  );
}

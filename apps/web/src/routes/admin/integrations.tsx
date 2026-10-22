import { type ApiKeyKind, apiKeyCreateSchema } from "@openturnly/core";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, CopyField, Field, Input, Spinner } from "../../components/ui.tsx";
import type { ApiKey } from "../../lib/api.ts";
import { useApiKeyMutations, useApiKeys } from "../../lib/businesses.ts";
import { cn } from "../../lib/cn.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { formatDate } from "../../lib/locale.ts";
import { useBusinessContext } from "./business.tsx";

/** The business's MCP server: AI agents connect here with one of its keys. */
function mcpUrl(slug: string) {
  return `${window.location.origin}/${slug}/mcp`;
}

/** Settings → Integrations: connect AI agents (WhatsApp bots, Claude…) through MCP. */
export function IntegrationsTab() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "es";
  const { business } = useBusinessContext();
  const keys = useApiKeys(business.id);
  const { revoke } = useApiKeyMutations(business.id);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);

  const columns: Column<ApiKey>[] = [
    {
      key: "name",
      header: t("integrations.colName"),
      cell: (key) => (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
            <KeyRound className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{key.name}</p>
            <p className="font-mono text-xs text-zinc-500">ot_…{key.hint}</p>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: t("integrations.colKind"),
      cell: (key) => (
        <Badge tone={key.kind === "admin" ? "brand" : "neutral"}>
          {t(`integrations.kinds.${key.kind}`)}
        </Badge>
      ),
    },
    {
      key: "used",
      header: t("integrations.colUsed"),
      className: "hidden md:table-cell",
      cell: (key) => (
        <span className="text-zinc-600">
          {key.lastUsedAt ? formatDate(key.lastUsedAt, language) : t("integrations.neverUsed")}
        </span>
      ),
    },
    {
      key: "created",
      header: t("integrations.colCreated"),
      className: "hidden lg:table-cell",
      cell: (key) => (
        <span className="text-zinc-600">
          {formatDate(key.createdAt, language)}
          {key.createdByName && <span className="text-zinc-400"> · {key.createdByName}</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (key) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-500 hover:text-red-600"
          onClick={async () => {
            const ok = await confirm({
              title: t("integrations.revokeTitle", { name: key.name }),
              description: t("integrations.revokeBody"),
              confirmLabel: t("integrations.revoke"),
              tone: "danger",
            });
            if (ok) {
              revoke.mutate(key.id, {
                onSuccess: () => toast.success(t("integrations.revoked")),
                onError: (error) => toast.error(errorMessage(t, error)),
              });
            }
          }}
        >
          {t("integrations.revoke")}
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-900">{t("integrations.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("integrations.subtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {t("integrations.newKey")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-800">{t("integrations.urlTitle")}</p>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t("integrations.urlHint")}</p>
        </div>
        <div className="w-full md:max-w-xl">
          <CopyField value={mcpUrl(business.slug)} label={t("integrations.urlTitle")} />
        </div>
      </div>

      {keys.isPending ? (
        <Spinner />
      ) : keys.isError ? (
        <Alert>{errorMessage(t, keys.error)}</Alert>
      ) : (
        <DataTable
          columns={columns}
          rows={keys.data}
          rowKey={(key) => key.id}
          empty={t("integrations.none")}
        />
      )}

      {creating && <CreateKeyModal onClose={() => setCreating(false)} />}
    </section>
  );
}

/** Name and kind of a new key; then the key itself, once, with ready-to-paste settings. */
function CreateKeyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { create } = useApiKeyMutations(business.id);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ApiKeyKind>("agent");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [token, setToken] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(apiKeyCreateSchema, { name, kind });
    setErrors(result.errors ?? {});
    if (!result.data) return;
    create.mutate(result.data, {
      onSuccess: (created) => setToken(created.token),
      onError: (error) => {
        setErrors(apiFieldErrors(error));
        toast.error(errorMessage(t, error));
      },
    });
  };

  if (token) return <KeyReady token={token} name={name} onDone={onClose} />;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("integrations.newKey")}
      description={t("integrations.newKeyHint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="api-key-form" loading={create.isPending}>
            {t("integrations.create")}
          </Button>
        </>
      }
    >
      <form id="api-key-form" onSubmit={submit} noValidate className="space-y-5">
        <Field
          label={t("integrations.keyName")}
          hint={t("integrations.keyNameHint")}
          error={fieldMessage(t, "name", errors.name)}
        >
          {(props) => (
            <Input
              {...props}
              value={name}
              placeholder={t("integrations.keyNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-zinc-800">
            {t("integrations.colKind")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["agent", "admin"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  kind === option
                    ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500"
                    : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <span className="block text-sm font-medium text-zinc-900">
                  {t(`integrations.kinds.${option}`)}
                </span>
                <span className="mt-0.5 block text-[13px] text-zinc-500">
                  {t(`integrations.kindHints.${option}`)}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-800">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="size-4 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-zinc-800">
        {value}
      </pre>
    </div>
  );
}

function KeyReady({ token, name, onDone }: { token: string; name: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const url = mcpUrl(business.slug);
  const config = JSON.stringify(
    {
      mcpServers: {
        [business.slug]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
  return (
    <Modal
      open
      wide
      onClose={onDone}
      title={t("integrations.readyTitle", { name })}
      description={t("integrations.readyHint")}
      footer={<Button onClick={onDone}>{t("access.done")}</Button>}
    >
      <div className="space-y-4">
        <CopyBlock label={t("integrations.key")} value={token} />
        <div className="grid gap-4 md:grid-cols-2">
          <CopyBlock label={t("integrations.urlTitle")} value={url} />
          <CopyBlock label={t("integrations.header")} value={`Authorization: Bearer ${token}`} />
        </div>
        <CopyBlock label={t("integrations.config")} value={config} />
      </div>
    </Modal>
  );
}

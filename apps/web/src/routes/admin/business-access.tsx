import { type BusinessRole, memberCreateSchema, PASSWORD_MIN_LENGTH } from "@openturnly/core";
import { Check, Copy, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";
import { useConfirm } from "../../components/confirm.tsx";
import { Modal, SettingsCard } from "../../components/controls.tsx";
import { type Column, DataTable, IdentityCell } from "../../components/data-table.tsx";
import { PasswordField } from "../../components/password-field.tsx";
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
import { ApiError, type Member } from "../../lib/api.ts";
import { useAccess, useAccessMutations } from "../../lib/businesses.ts";
import { useProfessionals } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { formatDate } from "../../lib/locale.ts";
import { generatePassword } from "../../lib/password.ts";
import { useBusinessContext } from "./business.tsx";

/** The business's own sign-in page, to share with the people who work there. */
function teamLoginUrl(slug: string) {
  return `${window.location.origin}/${slug}/login`;
}

/** Old address of the users page: it now lives in Settings → General. */
export function BusinessAccessPage() {
  return <Navigate to="../settings" replace />;
}

type AccessRow =
  | ({ kind: "member" } & Member)
  | { kind: "invitation"; id: string; email: string; expiresAt: string };

/** "Administrador" / "Profesional", with what each can do. */
function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: BusinessRole;
  onChange: (role: BusinessRole) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["admin", "professional"] as const).map((role) => (
        <button
          key={role}
          type="button"
          disabled={disabled}
          aria-pressed={value === role}
          onClick={() => onChange(role)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === role
              ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500"
              : "border-zinc-200 hover:border-zinc-300",
          )}
        >
          <span className="block text-sm font-medium text-zinc-900">
            {t(`access.roles.${role}`)}
          </span>
          <span className="mt-0.5 block text-[13px] text-zinc-500">
            {t(`access.roleHints.${role}`)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Which professional profile a "Profesional" user is. */
function ProfilePicker({
  value,
  onChange,
  takenIds,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  takenIds: string[];
  error?: string;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const professionals = useProfessionals(business.id);
  if (professionals.data?.length === 0) {
    return (
      <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600">
        {t("access.noProfiles")}{" "}
        <Link to="../professionals" className="font-medium text-brand-700 hover:underline">
          {t("nav.professionals")}
        </Link>
      </p>
    );
  }
  return (
    <Field label={t("access.profile")} hint={t("access.profileHint")} error={error}>
      {(props) => (
        <Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t("access.chooseProfile")}</option>
          {professionals.data?.map((professional) => (
            <option
              key={professional.id}
              value={professional.id}
              disabled={takenIds.includes(professional.id) && professional.id !== value}
            >
              {professional.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Settings → Users: who works in this business, how, and with which account. */
export function UsersSection() {
  const { t, i18n } = useTranslation();
  const { business, user } = useBusinessContext();
  const access = useAccess(business.id);
  const { revokeInvitation } = useAccessMutations(business.id);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const members = access.data?.members ?? [];
  const takenIds = members.flatMap((member) => (member.resourceId ? [member.resourceId] : []));
  const language = i18n.resolvedLanguage ?? "es";
  const rows: AccessRow[] = [
    ...members.map((member) => ({ kind: "member" as const, ...member })),
    ...(access.data?.invitations.map((invitation) => ({
      kind: "invitation" as const,
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    })) ?? []),
  ];

  const columns: Column<AccessRow>[] = [
    {
      key: "user",
      header: t("access.colUser"),
      cell: (row) =>
        row.kind === "member" ? (
          <IdentityCell initial={row.name} title={row.name} subtitle={row.email} />
        ) : (
          <IdentityCell initial={row.email} title={row.email} />
        ),
    },
    {
      key: "role",
      header: t("access.colRole"),
      cell: (row) =>
        row.kind === "member" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.role === "admin" ? "brand" : "neutral"}>
              {t(`access.roles.${row.role}`)}
            </Badge>
            {row.userId === user.id && <Badge>{t("access.you")}</Badge>}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-0.5">
            <Badge tone="warning">{t("access.statusPending")}</Badge>
            <span className="text-xs text-zinc-500">
              {t("access.expires", { date: formatDate(row.expiresAt, language) })}
            </span>
          </div>
        ),
    },
    {
      key: "profile",
      header: t("access.colProfile"),
      className: "hidden md:table-cell",
      cell: (row) => (
        <span className="text-zinc-600">
          {row.kind === "member" && row.role === "professional"
            ? (row.resourceName ?? "—")
            : t("access.allAgendas")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) =>
        row.kind === "invitation" ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-500 hover:text-red-600"
            onClick={async (event) => {
              event.stopPropagation();
              const ok = await confirm({
                title: t("access.revokeTitle"),
                description: row.email,
                confirmLabel: t("access.revoke"),
                tone: "danger",
              });
              if (ok) {
                revokeInvitation.mutate(row.id, {
                  onSuccess: () => toast.success(t("access.revoked")),
                });
              }
            }}
          >
            {t("access.revoke")}
          </Button>
        ) : (
          <span className="text-[13px] font-medium text-brand-700">{t("common.edit")}</span>
        ),
    },
  ];

  return (
    <>
      <SettingsCard
        title={t("access.title")}
        description={t("access.subtitle")}
        action={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden />
            {t("access.createTitle")}
          </Button>
        }
        attached={
          access.isPending ? (
            <Spinner />
          ) : access.isError ? (
            <div className="p-5">
              <Alert>{errorMessage(t, access.error)}</Alert>
            </div>
          ) : (
            <DataTable
              flush
              columns={columns}
              rows={rows}
              rowKey={(row) =>
                row.kind === "member" ? `member-${row.userId}` : `invite-${row.id}`
              }
              onRowClick={(row) => {
                if (row.kind === "member") setEditing(row);
              }}
              searchPlaceholder={rows.length > 5 ? t("access.search") : undefined}
              matches={(row, query) =>
                row.email.includes(query) ||
                (row.kind === "member" && row.name.toLowerCase().includes(query))
              }
              empty={t("access.none")}
            />
          )
        }
      >
        <div className="flex flex-col gap-3 rounded-lg bg-zinc-50 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-800">{t("access.teamLogin")}</p>
            <p className="mt-0.5 text-[13px] text-zinc-500">{t("access.teamLoginHint")}</p>
          </div>
          <div className="w-full md:max-w-xl">
            <CopyField value={teamLoginUrl(business.slug)} label={t("access.teamLogin")} />
          </div>
        </div>
      </SettingsCard>

      {creating && <CreateAccessModal takenIds={takenIds} onClose={() => setCreating(false)} />}
      {editing && (
        <MemberModal member={editing} takenIds={takenIds} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** Name, email, role and password in one go; then the details to hand over. */
function CreateAccessModal({ takenIds, onClose }: { takenIds: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { create } = useAccessMutations(business.id);
  const [values, setValues] = useState({
    name: "",
    email: "",
    role: "professional" as BusinessRole,
    resourceId: "",
    password: generatePassword(),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ready, setReady] = useState<{ email: string; password: string | null } | null>(null);
  const set = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = {
      ...values,
      resourceId: values.role === "professional" ? values.resourceId || null : null,
    };
    const result = validate(memberCreateSchema, input);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    const email = result.data.email;
    create.mutate(input, {
      onSuccess: ({ created }) => setReady({ email, password: created ? values.password : null }),
      onError: (error) => {
        setErrors(apiFieldErrors(error));
        if (!(error instanceof ApiError) || !Object.keys(error.fields).length) {
          toast.error(errorMessage(t, error));
        }
      },
    });
  };

  if (ready) return <AccessReady ready={ready} onDone={onClose} />;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("access.createTitle")}
      description={t("access.createHint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="member-form" loading={create.isPending}>
            <UserPlus className="size-4" aria-hidden />
            {t("access.create")}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.name")} error={fieldMessage(t, "name", errors.name)}>
            {(props) => (
              <Input
                {...props}
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
              />
            )}
          </Field>
          <Field label={t("fields.email")} error={fieldMessage(t, "email", errors.email)}>
            {(props) => (
              <Input
                {...props}
                type="email"
                placeholder={t("access.emailPlaceholder")}
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium text-zinc-800">
            {t("access.colRole")}
          </legend>
          <RolePicker value={values.role} onChange={(role) => set("role", role)} />
        </fieldset>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {values.role === "professional" && (
            <ProfilePicker
              value={values.resourceId}
              onChange={(id) => set("resourceId", id)}
              takenIds={takenIds}
              error={fieldMessage(t, "resourceId", errors.resourceId)}
            />
          )}
          <Field
            label={t("fields.password")}
            hint={t("access.passwordHint")}
            error={fieldMessage(t, "password", errors.password)}
          >
            {(props) => (
              <PasswordField
                id={props.id}
                describedBy={props["aria-describedby"]}
                invalid={Boolean(errors.password)}
                value={values.password}
                onChange={(password) => set("password", password)}
              />
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/** The details to hand over once the access exists, with one button to copy them all. */
function AccessReady({
  ready,
  onDone,
}: {
  ready: { email: string; password: string | null };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { business } = useBusinessContext();
  const loginUrl = teamLoginUrl(business.slug);
  const text = [
    t("access.shareIntro", { url: loginUrl }),
    `${t("fields.email")}: ${ready.email}`,
    ...(ready.password ? [`${t("fields.password")}: ${ready.password}`] : []),
  ].join("\n");

  return (
    <Modal
      open
      onClose={onDone}
      title={t("access.readyTitle")}
      description={ready.password ? t("access.readyHint") : t("access.readyExisting")}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(text);
              setCopied(true);
            }}
          >
            {copied ? (
              <Check className="size-4 text-emerald-600" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? t("common.copied") : t("access.copyDetails")}
          </Button>
          <Button onClick={onDone}>{t("access.done")}</Button>
        </>
      }
    >
      <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm">
        <div className="flex justify-between gap-3 px-3 py-2.5">
          <dt className="text-zinc-500">{t("access.loginAt")}</dt>
          <dd className="truncate font-medium text-zinc-900">{loginUrl}</dd>
        </div>
        <div className="flex justify-between gap-3 px-3 py-2.5">
          <dt className="text-zinc-500">{t("fields.email")}</dt>
          <dd className="truncate font-medium text-zinc-900">{ready.email}</dd>
        </div>
        {ready.password && (
          <div className="flex justify-between gap-3 px-3 py-2.5">
            <dt className="text-zinc-500">{t("fields.password")}</dt>
            <dd className="font-mono font-medium text-zinc-900">{ready.password}</dd>
          </div>
        )}
      </dl>
    </Modal>
  );
}

/** Change someone's role, give them a new password, or take their access away. */
function MemberModal({
  member,
  takenIds,
  onClose,
}: {
  member: Member;
  takenIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business, user } = useBusinessContext();
  const { update, resetPassword, removeMember } = useAccessMutations(business.id);
  const confirm = useConfirm();
  const self = member.userId === user.id;
  const [role, setRole] = useState<BusinessRole>(member.role);
  const [resourceId, setResourceId] = useState(member.resourceId ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = () => {
    if (role === "professional" && !resourceId) {
      setErrors({ resourceId: "required" });
      return;
    }
    update.mutate(
      { userId: member.userId, role, resourceId: role === "professional" ? resourceId : null },
      {
        onSuccess: () => {
          toast.success(t("common.saved"));
          onClose();
        },
        onError: (error) => {
          setErrors(apiFieldErrors(error));
          toast.error(errorMessage(t, error));
        },
      },
    );
  };

  const changePassword = () => {
    resetPassword.mutate(
      { userId: member.userId, password },
      {
        onSuccess: () => toast.success(t("access.passwordChanged")),
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.status === 403
              ? t("access.resetForbidden")
              : (fieldMessage(t, "password", apiFieldErrors(error).password) ??
                  errorMessage(t, error)),
          ),
      },
    );
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("access.removeTitle", { name: member.name }),
      description: t("access.removeBody"),
      confirmLabel: t("access.remove"),
      tone: "danger",
    });
    if (!ok) return;
    removeMember.mutate(member.userId, {
      onSuccess: () => {
        toast.success(t("access.removed"));
        onClose();
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={member.name}
      description={member.email}
      footer={
        <>
          {!self && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={removeMember.isPending}
              onClick={remove}
            >
              {t("access.remove")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={update.isPending} disabled={self}>
            {t("common.saveChanges")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <RolePicker value={role} onChange={setRole} disabled={self} />
        {self && <p className="text-[13px] text-zinc-500">{t("access.ownRole")}</p>}
        {role === "professional" && (
          <ProfilePicker
            value={resourceId}
            onChange={setResourceId}
            takenIds={takenIds}
            error={fieldMessage(t, "resourceId", errors.resourceId)}
          />
        )}
        <div className="space-y-2 border-t border-zinc-100 pt-4">
          <p className="text-sm font-medium text-zinc-800">{t("access.newPassword")}</p>
          <p className="text-[13px] text-zinc-500">{t("access.newPasswordHint")}</p>
          <PasswordField value={password} onChange={setPassword} />
          <Button
            variant="secondary"
            size="sm"
            disabled={password.length < PASSWORD_MIN_LENGTH}
            loading={resetPassword.isPending}
            onClick={changePassword}
          >
            {t("access.changePassword")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

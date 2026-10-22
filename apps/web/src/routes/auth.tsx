import { loginSchema, setupSchema } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { BookingBackdrop } from "../components/booking-backdrop.tsx";
import { AuthLayout, LanguageSwitcher } from "../components/brand.tsx";
import { PasswordInput } from "../components/controls.tsx";
import { Alert, Button, buttonClass, Field, Input, Spinner } from "../components/ui.tsx";
import { ApiError, api, type Business } from "../lib/api.ts";
import { usePublicCatalog } from "../lib/booking.ts";
import { brandStyle } from "../lib/brand.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../lib/forms.ts";
import { loginPath, rememberLogin, useMe, useSetupStatus } from "../lib/session.ts";

/** "/" sends people where they belong: setup, login or the admin panel. */
export function HomeRedirect() {
  const setup = useSetupStatus();
  const me = useMe();
  if (setup.isError || me.isError) return <ServerUnavailable error={setup.error ?? me.error} />;
  if (setup.isPending || me.isPending) return <Spinner className="min-h-screen" />;
  if (setup.data.needsSetup) return <Navigate to="/setup" replace />;
  return <Navigate to={me.data ? "/admin" : loginPath()} replace />;
}

/** Shown when the API cannot be reached, instead of an endless spinner. */
function ServerUnavailable({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t("errors.network")}>
      <Alert>{errorMessage(t, error)}</Alert>
      <Button variant="secondary" className="mt-4 w-full" onClick={() => window.location.reload()}>
        {t("common.retry")}
      </Button>
    </AuthLayout>
  );
}

type Credentials = { name?: string; email: string; password: string };

function CredentialsForm({
  withName,
  fixedEmail,
  submitLabel,
  errors,
  serverError,
  pending,
  onSubmit,
}: {
  withName: boolean;
  fixedEmail?: string;
  submitLabel: string;
  errors: FieldErrors;
  serverError?: string;
  pending: boolean;
  onSubmit: (values: Credentials) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Credentials>({
    name: "",
    email: fixedEmail ?? "",
    password: "",
  });
  const set = (field: keyof Credentials) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [field]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {serverError && <Alert>{serverError}</Alert>}
      {withName && (
        <Field label={t("fields.yourName")} error={fieldMessage(t, "name", errors.name)}>
          {(props) => (
            <Input {...props} autoComplete="name" value={values.name} onChange={set("name")} />
          )}
        </Field>
      )}
      <Field label={t("fields.email")} error={fieldMessage(t, "email", errors.email)}>
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            disabled={fixedEmail !== undefined}
          />
        )}
      </Field>
      <Field
        label={t("fields.password")}
        hint={withName ? t("fields.passwordHint") : undefined}
        error={fieldMessage(t, "password", errors.password)}
      >
        {(props) => (
          <PasswordInput
            {...props}
            autoComplete={withName ? "new-password" : "current-password"}
            value={values.password}
            onChange={set("password")}
          />
        )}
      </Field>
      <Button type="submit" loading={pending} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Shared submit logic: validate locally, call the API, then reload the session. The request
 * may return where to go next; the admin home otherwise.
 */
function useCredentialsSubmit(
  schema: Parameters<typeof validate>[0],
  request: (data: Credentials) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: async (next) => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.setQueryData(["setup"], { needsSetup: false });
      navigate(typeof next === "string" ? next : "/admin", { replace: true });
    },
  });

  const submit = (values: Credentials) => {
    const result = validate(schema, values);
    setLocalErrors(result.errors ?? {});
    if (result.data) mutation.mutate(result.data as Credentials);
  };

  const serverFields = mutation.error instanceof ApiError ? mutation.error.fields : {};
  return { mutation, submit, errors: { ...serverFields, ...localErrors } };
}

export function SetupPage() {
  const { t } = useTranslation();
  const setup = useSetupStatus();
  const { mutation, submit, errors } = useCredentialsSubmit(setupSchema, (body) =>
    api("/api/setup", { method: "POST", body }),
  );

  if (setup.isError) return <ServerUnavailable error={setup.error} />;
  if (setup.isPending) return <Spinner className="min-h-screen" />;
  if (!setup.data?.needsSetup && !mutation.isSuccess) return <Navigate to="/login" replace />;

  return (
    <AuthLayout title={t("setup.title")} subtitle={t("setup.subtitle")}>
      <CredentialsForm
        withName
        submitLabel={t("setup.submit")}
        errors={errors}
        serverError={mutation.isError ? errorMessage(t, mutation.error) : undefined}
        pending={mutation.isPending}
        onSubmit={submit}
      />
    </AuthLayout>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const setup = useSetupStatus();
  const me = useMe();
  const { mutation, submit, errors } = useCredentialsSubmit(loginSchema, async (body) => {
    await api("/api/auth/sign-in/email", { method: "POST", body });
    rememberLogin(null);
  });

  if (setup.isError || me.isError) return <ServerUnavailable error={setup.error ?? me.error} />;
  if (setup.isPending || me.isPending) return <Spinner className="min-h-screen" />;
  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me.data && !mutation.isPending) return <Navigate to="/admin" replace />;

  return (
    <AuthLayout title={t("login.title")} subtitle={t("login.subtitle")}>
      <CredentialsForm
        withName={false}
        submitLabel={t("login.submit")}
        errors={errors}
        serverError={mutation.isError ? errorMessage(t, mutation.error) : undefined}
        pending={mutation.isPending}
        onSubmit={submit}
      />
    </AuthLayout>
  );
}

/**
 * A business's own sign-in page, "/barberia-el-amigo/login": its name, logo and colours, for
 * the people who work there. Accounts are the same everywhere; this only checks that the
 * person has access to this business and takes them straight to it.
 */
export function BusinessLoginPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const catalog = usePublicCatalog(slug);
  const me = useMe();
  const { mutation, submit, errors } = useCredentialsSubmit(loginSchema, async (body) => {
    await api("/api/auth/sign-in/email", { method: "POST", body });
    const { businesses } = await api<{ businesses: Business[] }>("/api/businesses");
    const business = businesses.find((candidate) => candidate.slug === slug);
    if (!business) {
      await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => undefined);
      throw new ApiError(403, "no_access_here");
    }
    rememberLogin(slug);
    return `/admin/businesses/${business.id}`;
  });

  if (me.isError) return <ServerUnavailable error={me.error} />;
  if (catalog.isPending || me.isPending) return <Spinner className="min-h-screen" />;
  if (catalog.isError) {
    return (
      <AuthLayout title={t("notFound.title")}>
        <Link to="/login" className={buttonClass({ className: "w-full" })}>
          {t("invite.goToLogin")}
        </Link>
      </AuthLayout>
    );
  }
  if (me.data && !mutation.isPending) return <Navigate to="/admin" replace />;

  const business = catalog.data.business;
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={brandStyle(business.brandColor)}
    >
      <BookingBackdrop fixed theme={business.pageTheme} coverUrl={business.coverUrl} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xl">
        <div className="px-6 pt-8 pb-6 text-center sm:px-8">
          <div className="mx-auto grid size-16 place-items-center overflow-hidden rounded-2xl bg-brand-600 text-2xl font-semibold text-on-brand shadow-sm">
            {business.logoUrl ? (
              <img src={business.logoUrl} alt="" className="size-full bg-white object-cover" />
            ) : (
              business.name.charAt(0).toUpperCase()
            )}
          </div>
          <p className="mt-5 text-xs font-medium tracking-wide text-brand-700 uppercase">
            {t("businessLogin.eyebrow")}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">{business.name}</h1>
          <p className="mt-2 text-sm text-zinc-500">{t("businessLogin.subtitle")}</p>
        </div>
        <div className="px-6 pb-6 sm:px-8">
          <CredentialsForm
            withName={false}
            submitLabel={t("login.submit")}
            errors={errors}
            serverError={mutation.isError ? errorMessage(t, mutation.error) : undefined}
            pending={mutation.isPending}
            onSubmit={submit}
          />
        </div>
        <div className="flex justify-center border-t border-zinc-100 bg-zinc-50/70 py-3">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}

export function InvitePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const invitation = useInvitation(token);
  const { mutation, submit, errors } = useCredentialsSubmit(setupSchema, ({ name, password }) =>
    api(`/api/invitations/${token}/accept`, { method: "POST", body: { name, password } }),
  );

  if (invitation.isPending || mutation.isSuccess) return <Spinner className="min-h-screen" />;

  const accountExists =
    mutation.error instanceof ApiError && mutation.error.code === "account_exists";
  if (invitation.isError || accountExists) {
    return (
      <AuthLayout
        title={accountExists ? t("login.title") : t("invite.invalidTitle")}
        subtitle={accountExists ? t("invite.accountExists") : t("invite.invalidBody")}
      >
        <Link to="/login" className={buttonClass({ className: "w-full" })}>
          {t("invite.goToLogin")}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("invite.title", { business: invitation.data.businessName })}
      subtitle={t("invite.subtitle")}
    >
      <CredentialsForm
        withName
        fixedEmail={invitation.data.email}
        submitLabel={t("invite.submit")}
        errors={errors}
        serverError={mutation.isError ? errorMessage(t, mutation.error) : undefined}
        pending={mutation.isPending}
        onSubmit={submit}
      />
    </AuthLayout>
  );
}

function useInvitation(token: string) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<{ email: string; businessName: string }>(`/api/invitations/${token}`),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

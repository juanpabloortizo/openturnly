import { accountUpdateSchema, PASSWORD_MIN_LENGTH, passwordChangeSchema } from "@openturnly/core";
import {
  ChevronsUpDown,
  Compass,
  Languages,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  Sun,
  SunMoon,
  UserRound,
} from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/brand.tsx";
import { useClickOutside } from "../../components/combobox.tsx";
import { Modal, PasswordInput } from "../../components/controls.tsx";
import { PasswordField } from "../../components/password-field.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Input } from "../../components/ui.tsx";
import type { User } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { useAccountMutations, useLogout, useVersion } from "../../lib/session.ts";
import { setTheme, THEMES, type Theme, useTheme } from "../../lib/theme.ts";
import { useTourMutations } from "../../lib/tours.ts";

const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/**
 * The signed-in person at the bottom of the sidebar. Opens a menu with their account,
 * the language, the theme and signing out.
 */
export function AccountMenu({
  user,
  collapsed,
  roleLabel,
}: {
  user: User;
  collapsed: boolean;
  /** "Administrador", "Profesional"… for the business on screen. */
  roleLabel: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(open, [ref], () => setOpen(false));
  const logout = useLogout();
  const version = useVersion(user.role === "owner");
  const { replay } = useTourMutations();

  return (
    <div ref={ref} className="relative border-t border-zinc-200 p-3" data-tour="account">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? `${user.name} · ${user.email}` : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-zinc-100",
          collapsed && "justify-center",
          open && "bg-zinc-100",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initials(user.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-zinc-900">{user.name}</span>
              <span className="block truncate text-xs text-zinc-500">{user.email}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-200",
            collapsed ? "bottom-3 left-full ml-2 w-64" : "inset-x-3 bottom-full mb-1",
          )}
        >
          <div className="px-2.5 pt-1.5 pb-2.5">
            <p className="truncate text-sm font-medium text-zinc-900">{user.name}</p>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
            {roleLabel && (
              <p className="mt-1.5 text-xs font-medium text-brand-700">
                {roleLabel}
                {version.data && (
                  <span className="ml-1.5 font-normal text-zinc-400">v{version.data}</span>
                )}
              </p>
            )}
          </div>
          <div className="space-y-0.5 border-t border-zinc-100 pt-1.5">
            <MenuItem
              icon={UserRound}
              onClick={() => {
                setOpen(false);
                setEditing(true);
              }}
            >
              {t("account.title")}
            </MenuItem>
            <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                <Languages className="size-4 text-zinc-400" aria-hidden />
                {t("account.language")}
              </span>
              <LanguageSwitcher />
            </div>
            <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                <SunMoon className="size-4 text-zinc-400" aria-hidden />
                {t("account.theme")}
              </span>
              <ThemeSwitcher />
            </div>
            <MenuItem
              icon={Compass}
              onClick={() => {
                setOpen(false);
                replay.mutate();
              }}
            >
              {t("tour.replay")}
            </MenuItem>
          </div>
          <div className="mt-1.5 border-t border-zinc-100 pt-1.5">
            <MenuItem icon={LogOut} onClick={() => logout.mutate()} disabled={logout.isPending}>
              {t("nav.logout")}
            </MenuItem>
          </div>
        </div>
      )}

      {editing && <AccountModal user={user} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  disabled,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
    >
      <Icon className="size-4 text-zinc-400" aria-hidden />
      {children}
    </button>
  );
}

/** Light, dark or whatever the device uses; remembered on this device. */
function ThemeSwitcher() {
  const { t } = useTranslation();
  const current = useTheme();
  return (
    <fieldset className="inline-flex rounded-lg bg-zinc-100 p-0.5">
      <legend className="sr-only">{t("account.theme")}</legend>
      {THEMES.map((theme) => {
        const Icon = THEME_ICONS[theme];
        return (
          <button
            key={theme}
            type="button"
            onClick={() => setTheme(theme)}
            aria-pressed={current === theme}
            aria-label={t(`account.themes.${theme}`)}
            title={t(`account.themes.${theme}`)}
            className={cn(
              "grid h-6 w-7 place-items-center rounded-md transition-colors",
              current === theme
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-900",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </fieldset>
  );
}

/** "Mi cuenta": name and email, and the password, each saved on its own. */
function AccountModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const { update, changePassword } = useAccountMutations();
  const [details, setDetails] = useState({
    name: user.name,
    email: user.email,
    currentPassword: "",
  });
  const [detailErrors, setDetailErrors] = useState<FieldErrors>({});
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [passwordErrors, setPasswordErrors] = useState<FieldErrors>({});
  const emailChanged = details.email.trim().toLowerCase() !== user.email;

  const saveDetails = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(accountUpdateSchema, {
      name: details.name,
      email: details.email,
      currentPassword: emailChanged ? details.currentPassword : undefined,
    });
    setDetailErrors(result.errors ?? {});
    if (!result.data) return;
    update.mutate(result.data, {
      onSuccess: () => {
        toast.success(t("common.saved"));
        setDetails((current) => ({ ...current, currentPassword: "" }));
      },
      onError: (error) => {
        setDetailErrors(apiFieldErrors(error));
        toast.error(errorMessage(t, error));
      },
    });
  };

  const savePassword = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(passwordChangeSchema, passwords);
    setPasswordErrors(result.errors ?? {});
    if (!result.data) return;
    changePassword.mutate(result.data, {
      onSuccess: () => {
        toast.success(t("account.passwordChanged"));
        setPasswords({ currentPassword: "", newPassword: "" });
      },
      onError: (error) => {
        setPasswordErrors(apiFieldErrors(error));
        toast.error(errorMessage(t, error));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={t("account.title")} description={t("account.subtitle")}>
      <form onSubmit={saveDetails} className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900">{t("account.details")}</h3>
        <Field label={t("fields.name")} error={fieldMessage(t, "name", detailErrors.name)}>
          {(props) => (
            <Input
              {...props}
              autoComplete="name"
              value={details.name}
              onChange={(event) => setDetails({ ...details, name: event.target.value })}
            />
          )}
        </Field>
        <Field label={t("fields.email")} error={fieldMessage(t, "email", detailErrors.email)}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={details.email}
              onChange={(event) => setDetails({ ...details, email: event.target.value })}
            />
          )}
        </Field>
        {emailChanged && (
          <Field
            label={t("account.currentPassword")}
            hint={t("account.emailNeedsPassword")}
            error={fieldMessage(t, "currentPassword", detailErrors.currentPassword)}
          >
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="current-password"
                value={details.currentPassword}
                onChange={(event) =>
                  setDetails({ ...details, currentPassword: event.target.value })
                }
              />
            )}
          </Field>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending}>
            {t("common.saveChanges")}
          </Button>
        </div>
      </form>

      <form onSubmit={savePassword} className="mt-6 space-y-4 border-t border-zinc-100 pt-6">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{t("account.passwordTitle")}</h3>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t("account.passwordHint")}</p>
        </div>
        <Field
          label={t("account.currentPassword")}
          error={fieldMessage(t, "currentPassword", passwordErrors.currentPassword)}
        >
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(event) =>
                setPasswords({ ...passwords, currentPassword: event.target.value })
              }
            />
          )}
        </Field>
        <Field
          label={t("account.newPassword")}
          hint={t("account.newPasswordHint", { min: PASSWORD_MIN_LENGTH })}
          error={fieldMessage(t, "password", passwordErrors.newPassword)}
        >
          {(props) => (
            <PasswordField
              id={props.id}
              invalid={props["aria-invalid"]}
              describedBy={props["aria-describedby"]}
              value={passwords.newPassword}
              onChange={(newPassword) => setPasswords({ ...passwords, newPassword })}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={changePassword.isPending}>
            {t("account.changePassword")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

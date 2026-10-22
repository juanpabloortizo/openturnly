import type { AutomationAction, AutomationTrigger } from "@openturnly/core";
import type { TFunction } from "i18next";
import { ChevronDown, Clock, FilePlus2, Plus, Trash2, Webhook, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useClickOutside, useMenuPlacement } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Toggle } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Button, Spinner } from "../../components/ui.tsx";
import type { Automation } from "../../lib/api.ts";
import { useAutomationMutations, useAutomations } from "../../lib/businesses.ts";
import { errorMessage } from "../../lib/forms.ts";
import {
  duration,
  isTimed,
  StatusBadge,
  stepTitle,
  TEMPLATES,
  type Template,
  TRIGGERS,
} from "./automation-shared.tsx";
import { useBusinessContext } from "./business.tsx";

/** Settings → Automations: the business's flows; each opens in the flow builder. */
export function AutomationsTab() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const automations = useAutomations(business.id);
  const { setActive, remove } = useAutomationMutations(business.id);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const deleteAutomation = async (automation: Automation) => {
    const ok = await confirm({
      title: t("automations.deleteTitle", { name: automation.name }),
      description: t("automations.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(automation.id, {
      onSuccess: () => toast.success(t("automations.deleted")),
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };
  const open = (id: string, template?: string) =>
    navigate(`../automations/${id}${template ? `?template=${template}` : ""}`);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-900">{t("automations.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("automations.subtitle")}</p>
        </div>
        <NewAutomationMenu onPick={(template) => open("new", template)} />
      </div>

      {automations.isPending ? (
        <Spinner />
      ) : automations.isError ? (
        <Alert>{errorMessage(t, automations.error)}</Alert>
      ) : automations.data.length === 0 ? (
        <EmptyState
          icon={<Zap className="size-5" aria-hidden />}
          title={t("automations.emptyTitle")}
          body={t("automations.emptyBody")}
        />
      ) : (
        <ul className="space-y-2">
          {automations.data.map((automation) => (
            <li key={automation.id}>
              {/* biome-ignore lint/a11y/useSemanticElements: it holds a switch, which can't sit inside a button. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => open(automation.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(automation.id);
                }}
                className="flex cursor-pointer flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 transition-colors hover:border-zinc-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">{automation.name}</p>
                  <div className="mt-1.5">
                    <FlowChips
                      trigger={automation.trigger}
                      offsetMin={automation.offsetMin}
                      actions={automation.actions}
                    />
                  </div>
                </div>
                <LastSend delivery={automation.lastDelivery} />
                {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the switch handles keys itself. */}
                <div
                  className="flex items-center gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Toggle
                    checked={automation.active}
                    label={`${automation.name}: ${t("automations.active")}`}
                    onChange={(active) =>
                      setActive.mutate(
                        { automationId: automation.id, active },
                        { onError: (error) => toast.error(errorMessage(t, error)) },
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                    aria-label={`${t("automations.builder.delete")}: ${automation.name}`}
                    onClick={() => deleteAutomation(automation)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Nueva automatización": start blank or from one of the templates. */
function NewAutomationMenu({ onPick }: { onPick: (template?: Template["key"]) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(open, [ref], () => setOpen(false));
  const placement = useMenuPlacement(open, ref, 320, "right");
  const pick = (template?: Template["key"]) => {
    setOpen(false);
    onPick(template);
  };
  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <Plus className="size-4" aria-hidden />
        {t("automations.new")}
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          style={placement}
          className="absolute right-0 z-30 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-200"
        >
          <MenuOption
            icon={FilePlus2}
            title={t("automations.blank")}
            hint={t("automations.blankHint")}
            onClick={() => pick()}
          />
          <p className="mt-1 border-t border-zinc-100 px-2.5 pt-2.5 pb-1 text-xs font-medium text-zinc-500">
            {t("automations.fromTemplate")}
          </p>
          {TEMPLATES.map((template) => (
            <MenuOption
              key={template.key}
              icon={TRIGGERS.find((item) => item.value === template.trigger)?.icon ?? Zap}
              title={t(`automations.templates.${template.key}.name`)}
              hint={templateSummary(t, template)}
              onClick={() => pick(template.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof Zap;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-50"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-zinc-900">{title}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}

/** "Se acerca una cita · 1 hora antes de que empiece", "Termina una cita → Esperar 1 hora". */
function templateSummary(t: TFunction, template: Template) {
  const event = t(`automations.events.${template.trigger}`);
  if (isTimed(template.trigger)) {
    return `${event} · ${t("automations.timing.before", { time: duration(t, template.offsetMin) })}`;
  }
  if (template.wait) {
    return `${event} → ${t("automations.timing.wait", { time: duration(t, template.wait) })}`;
  }
  return event;
}

/** "Se acerca una cita · 1 hora antes → Esperar 10 min → api.example.com": a flow at a glance. */
function FlowChips({
  trigger,
  offsetMin,
  actions = [],
}: {
  trigger: AutomationTrigger;
  offsetMin: number;
  actions?: AutomationAction[];
}) {
  const { t } = useTranslation();
  const Icon = TRIGGERS.find((item) => item.value === trigger)?.icon ?? Zap;
  // Flows saved before wait steps existed may keep their wait on the trigger.
  const legacyWait = !isTimed(trigger) && offsetMin > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-brand-800">
        <Icon className="size-3.5" aria-hidden />
        {t(`automations.events.${trigger}`)}
        {isTimed(trigger) &&
          ` · ${t("automations.timing.before", { time: duration(t, offsetMin) })}`}
      </span>
      {legacyWait && (
        <Chip wait>{t("automations.timing.wait", { time: duration(t, offsetMin) })}</Chip>
      )}
      {actions.map((action) => (
        <Chip key={action.id} wait={action.type === "wait"}>
          {stepTitle(t, action)}
        </Chip>
      ))}
    </div>
  );
}

function Chip({ wait, children }: { wait?: boolean; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-400">
      →
      <span
        className={
          wait
            ? "inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-800"
            : "inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-sky-800"
        }
      >
        {wait ? (
          <Clock className="size-3.5" aria-hidden />
        ) : (
          <Webhook className="size-3.5" aria-hidden />
        )}
        {children}
      </span>
    </span>
  );
}

function LastSend({ delivery }: { delivery: Automation["lastDelivery"] }) {
  const { t, i18n } = useTranslation();
  if (!delivery) {
    return <span className="text-[13px] text-zinc-400">{t("automations.never")}</span>;
  }
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(delivery.createdAt));
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-zinc-500">
      <StatusBadge status={delivery.status} />
      {when}
    </span>
  );
}

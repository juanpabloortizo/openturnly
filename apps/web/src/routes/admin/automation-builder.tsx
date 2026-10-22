import {
  ALL_AUTOMATION_FIELDS,
  AUTOMATION_EVENTS,
  AUTOMATION_FIELDS,
  AUTOMATION_GROUPS,
  type AutomationAction,
  type AutomationField,
  type AutomationTrigger,
  automationSchema,
  fieldsBody,
  instantToZoned,
  jsonTemplateProblem,
  MAX_AUTOMATION_ACTIONS,
  MAX_AUTOMATION_WEBHOOKS,
  nestFields,
  renderJsonTemplate,
  renderTemplate,
  WEBHOOK_AUTH_TYPES,
  WEBHOOK_BODY_MODES,
  WEBHOOK_METHODS,
  type WebhookAction,
  type WebhookAuth,
} from "@openturnly/core";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Flag,
  type LucideIcon,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useClickOutside, useMenuPlacement } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { PasswordInput, Toggle } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, CopyField, Field, Input, Select, Spinner } from "../../components/ui.tsx";
import type { Automation, AutomationStepResult } from "../../lib/api.ts";
import {
  useAutomationDeliveries,
  useAutomationMutations,
  useAutomations,
} from "../../lib/businesses.ts";
import { useAppointments } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { formatDay } from "../../lib/format.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { addToJson, RAW_DATA, TemplateEditor } from "./automation-data.tsx";
import {
  duration,
  isTimed,
  MESSAGE,
  newWait,
  newWebhook,
  StatusBadge,
  sampleValues,
  splitOffset,
  stepTitle,
  TEMPLATES,
  type Template,
  TRIGGERS,
  UNITS,
  type Unit,
} from "./automation-shared.tsx";
import { useBusinessContext } from "./business.tsx";

/** What "choose the data" starts with. */
const STARTER_FIELDS: AutomationField[] = [
  "event",
  "appointment.code",
  "appointment.date",
  "appointment.time",
  "customer.name",
  "customer.phone",
];

/** What a step sends with fields, as a JSON body to reshape into the receiver's format. */
function fieldsAsJson(step: WebhookAction) {
  const body =
    step.fields === null
      ? Object.fromEntries(
          ["event", ...AUTOMATION_GROUPS].map((path) => [path, `{{${path}}}`] as const),
        )
      : nestFields(
          ALL_AUTOMATION_FIELDS.filter((field) => step.fields?.includes(field)),
          (field) => `{{${field}}}`,
        );
  for (const { name, value } of step.extra) if (name.trim()) body[name.trim()] = value;
  let json = JSON.stringify(body, null, 2);
  for (const path of RAW_DATA) json = json.replaceAll(`"{{${path}}}"`, `{{${path}}}`);
  return json;
}

type Draft = {
  name: string;
  /** Null until the business picks what starts the flow. */
  trigger: AutomationTrigger | null;
  /** Minutes before/after the appointment, for "before" and "after". */
  offsetMin: number;
  actions: AutomationAction[];
  active: boolean;
};

function toDraft(t: TFunction, automation: Automation | null, template?: Template): Draft {
  if (template) {
    return {
      name: t(`automations.templates.${template.key}.name`),
      trigger: template.trigger,
      offsetMin: template.offsetMin || 60,
      actions: [
        ...(template.wait ? [newWait(template.wait)] : []),
        newWebhook(t(`automations.templates.${template.key}.message`)),
      ],
      active: true,
    };
  }
  if (!automation) return { name: "", trigger: null, offsetMin: 60, actions: [], active: true };
  // Flows saved before wait steps existed kept their wait on the trigger: show it as a step.
  const legacyWait = !isTimed(automation.trigger) && automation.offsetMin > 0;
  return {
    name: automation.name,
    trigger: automation.trigger,
    offsetMin: isTimed(automation.trigger) ? automation.offsetMin : 60,
    actions: legacyWait
      ? [newWait(automation.offsetMin), ...automation.actions]
      : automation.actions,
    active: automation.active,
  };
}

/** The flow builder, at …/automations/new or …/automations/<id>. */
export function AutomationBuilderPage() {
  const { automationId = "new" } = useParams();
  const [search] = useSearchParams();
  const { business } = useBusinessContext();
  const automations = useAutomations(business.id);
  if (business.access.role === "professional") return <Navigate to=".." replace />;
  if (automationId !== "new" && automations.isPending) return <Spinner />;
  const automation =
    automationId === "new"
      ? null
      : (automations.data?.find((item) => item.id === automationId) ?? null);
  if (automationId !== "new" && !automation) {
    return <Navigate to="../settings?tab=automations" replace />;
  }
  const template = TEMPLATES.find((item) => item.key === search.get("template"));
  return <Builder key={automation?.id ?? "new"} automation={automation} template={template} />;
}

function Builder({ automation, template }: { automation: Automation | null; template?: Template }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const navigate = useNavigate();
  const { save, remove, test } = useAutomationMutations(business.id);
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => toDraft(t, automation, template));
  /** "trigger", a step's id, or null for the flow's overview. */
  const [selected, setSelected] = useState<string | null>(() =>
    template
      ? (draft.actions.find((action) => action.type === "webhook")?.id ?? null)
      : automation
        ? null
        : "trigger",
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [results, setResults] = useState<Record<string, AutomationStepResult>>({});
  const [testWith, setTestWith] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const webhooks = draft.actions.filter((action) => action.type === "webhook").length;
  const listPath = "../settings?tab=automations";

  /** The draft as the API wants it, or null (with the problem shown) if it isn't ready. */
  const check = (forTest = false) => {
    if (!draft.trigger) {
      setSelected("trigger");
      toast.error(t("automations.builder.chooseTrigger"));
      return null;
    }
    const values = {
      name: draft.name.trim() || (forTest ? "—" : t("automations.builder.untitled")),
      trigger: draft.trigger,
      offsetMin: isTimed(draft.trigger) ? draft.offsetMin : 0,
      actions: draft.actions.map((action) =>
        action.type === "wait"
          ? action
          : {
              ...action,
              headers: action.headers.filter((header) => header.name.trim()),
              extra: action.extra.filter((field) => field.name.trim() && field.value.trim()),
            },
      ),
      active: draft.active,
    };
    const result = validate(automationSchema, values);
    setErrors(result.errors ?? {});
    if (result.data) return result.data;
    const first = Object.keys(result.errors ?? {})[0] ?? "";
    const step = /^actions\.(\d+)\./.exec(first)?.[1];
    if (step !== undefined) setSelected(draft.actions[Number(step)]?.id ?? null);
    else if (first === "offsetMin") setSelected("trigger");
    else if (first === "actions") toast.error(t("automations.builder.webhookRequired"));
    return null;
  };

  const runTest = (actionId?: string) => {
    const flow = check(true);
    if (!flow) return;
    test.mutate(
      { automation: flow, automationId: automation?.id, appointmentId: testWith || null, actionId },
      {
        onSuccess: (list) => {
          setResults((current) => ({
            ...current,
            ...Object.fromEntries(list.map((result) => [result.actionId, result])),
          }));
          setTestOpen(false);
          const failed = list.filter((result) => !result.ok).length;
          if (failed) toast.error(t("automations.builder.testFailed", { count: failed }));
          else toast.success(t("automations.builder.testOk", { count: list.length }));
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  const submit = () => {
    const flow = check();
    if (!flow) return;
    save.mutate(
      { ...flow, automationId: automation?.id },
      {
        onSuccess: ({ automation: saved }) => {
          toast.success(t("common.saved"));
          if (!automation) navigate(`../automations/${saved.id}`, { replace: true });
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  const deleteAutomation = async () => {
    if (!automation) {
      // Never saved: there's nothing to delete, only the draft to leave behind.
      const started =
        draft.trigger !== null || draft.actions.length > 0 || draft.name.trim() !== "";
      if (
        started &&
        !(await confirm({
          title: t("automations.builder.discardTitle"),
          description: t("automations.builder.discardBody"),
          confirmLabel: t("common.discard"),
          tone: "danger",
        }))
      ) {
        return;
      }
      navigate(listPath);
      return;
    }
    const ok = await confirm({
      title: t("automations.deleteTitle", { name: automation.name }),
      description: t("automations.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(automation.id, {
      onSuccess: () => {
        toast.success(t("automations.deleted"));
        navigate(listPath);
      },
    });
  };

  const insertAt = (index: number, action: AutomationAction) => {
    setDraft((current) => ({
      ...current,
      actions: [...current.actions.slice(0, index), action, ...current.actions.slice(index)],
    }));
    setSelected(action.id);
  };
  const updateStep = (id: string, change: Partial<AutomationAction>) =>
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === id ? ({ ...action, ...change } as AutomationAction) : action,
      ),
    }));
  const removeStep = (id: string) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== id),
    }));
    if (selected === id) setSelected(null);
  };

  const selectedIndex = draft.actions.findIndex((action) => action.id === selected);
  const selectedStep = draft.actions[selectedIndex];
  const canAdd = draft.actions.length < MAX_AUTOMATION_ACTIONS;

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white lg:h-[calc(100dvh-4rem)]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-2.5">
        <Link
          to={listPath}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("automations.title")}</span>
        </Link>
        <input
          aria-label={t("automations.name")}
          value={draft.name}
          placeholder={t("automations.builder.untitled")}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-[15px] font-semibold text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-200 focus:border-brand-400 max-sm:basis-[calc(100%-3.5rem)]"
        />
        <div className="flex items-center gap-2 text-sm text-zinc-700 max-sm:mr-auto">
          <Toggle
            checked={draft.active}
            label={t("automations.active")}
            onChange={(active) => setDraft({ ...draft, active })}
          />
          <span className="hidden sm:inline">{t("automations.active")}</span>
        </div>
        <Button
          variant="ghost"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
          aria-label={automation ? t("automations.builder.delete") : t("common.discard")}
          loading={remove.isPending}
          onClick={deleteAutomation}
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">
            {automation ? t("common.delete") : t("common.discard")}
          </span>
        </Button>
        <TestMenu
          open={testOpen}
          onOpenChange={setTestOpen}
          value={testWith}
          onValue={setTestWith}
          running={test.isPending}
          onRun={() => runTest()}
        />
        <Button onClick={submit} loading={save.isPending}>
          {t("common.save")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Canvas */}
        <div className="min-w-0 flex-1 overflow-auto bg-zinc-50 bg-[radial-gradient(var(--color-zinc-300)_1px,transparent_1px)] bg-[size:18px_18px]">
          <div className="flex min-h-full flex-col items-center px-4 py-10">
            {draft.trigger ? (
              <FlowNode
                icon={TRIGGERS.find((item) => item.value === draft.trigger)?.icon ?? Zap}
                tone="trigger"
                eyebrow={t("automations.builder.trigger")}
                title={t(`automations.events.${draft.trigger}`)}
                detail={
                  isTimed(draft.trigger)
                    ? t("automations.timing.before", { time: duration(t, draft.offsetMin) })
                    : undefined
                }
                selected={selected === "trigger"}
                invalid={Boolean(errors.offsetMin)}
                onClick={() => setSelected("trigger")}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSelected("trigger")}
                className={cn(
                  "flex w-72 items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white/70 px-4 py-5 text-sm font-medium transition-colors",
                  selected === "trigger"
                    ? "border-brand-500 text-brand-700"
                    : "border-zinc-300 text-zinc-600 hover:border-brand-400 hover:text-brand-700",
                )}
              >
                <Plus className="size-4" aria-hidden />
                {t("automations.builder.addTrigger")}
              </button>
            )}

            {draft.actions.map((action, index) => (
              <div key={action.id} className="flex flex-col items-center">
                <AddStep
                  disabled={!canAdd}
                  webhooksLeft={webhooks < MAX_AUTOMATION_WEBHOOKS}
                  onAdd={(step) => insertAt(index, step)}
                />
                <FlowNode
                  icon={action.type === "wait" ? Clock : Webhook}
                  tone={action.type === "wait" ? "wait" : "webhook"}
                  eyebrow={
                    action.type === "wait"
                      ? t("automations.builder.wait")
                      : t("automations.builder.webhook")
                  }
                  title={
                    action.type === "wait" ? duration(t, action.minutes) : stepTitle(t, action)
                  }
                  selected={selected === action.id}
                  invalid={Object.keys(errors).some((key) => key.startsWith(`actions.${index}.`))}
                  onClick={() => setSelected(action.id)}
                  badge={results[action.id] && <ResultChip result={results[action.id]} />}
                  onRemove={() => removeStep(action.id)}
                  removeLabel={t("automations.step.remove")}
                />
              </div>
            ))}
            {draft.trigger ? (
              <AddStep
                disabled={!canAdd}
                webhooksLeft={webhooks < MAX_AUTOMATION_WEBHOOKS}
                onAdd={(step) => insertAt(draft.actions.length, step)}
              />
            ) : (
              <div className="h-8 w-px bg-zinc-300" aria-hidden />
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600">
              <Flag className="size-3" aria-hidden />
              {t("automations.builder.end")}
            </span>
          </div>
        </div>

        {/* Settings of the selected node */}
        <aside
          className={cn(
            "max-h-[60%] shrink-0 overflow-y-auto border-t border-zinc-200 bg-white p-5 md:max-h-none md:w-[24rem] md:border-t-0 xl:w-[30rem] md:border-l",
            selected === null && "hidden md:block",
          )}
        >
          {selected === "trigger" ? (
            <TriggerPanel
              trigger={draft.trigger}
              offsetMin={draft.offsetMin}
              errors={errors}
              onChange={(change) => setDraft((current) => ({ ...current, ...change }))}
              onClose={() => setSelected(null)}
            />
          ) : selectedStep?.type === "wait" ? (
            <WaitPanel
              key={selectedStep.id}
              minutes={selectedStep.minutes}
              onChange={(minutes) => updateStep(selectedStep.id, { minutes })}
              onClose={() => setSelected(null)}
            />
          ) : selectedStep?.type === "webhook" ? (
            <StepPanel
              key={selectedStep.id}
              index={selectedIndex}
              step={selectedStep}
              trigger={draft.trigger ?? "created"}
              errors={errors}
              result={results[selectedStep.id]}
              testing={test.isPending}
              onChange={(change) => updateStep(selectedStep.id, change)}
              onTest={() => runTest(selectedStep.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <Overview automation={automation} />
          )}
        </aside>
      </div>
    </div>
  );
}

/** "+" between nodes, with the kinds of step it can add. */
function AddStep({
  disabled,
  webhooksLeft,
  onAdd,
}: {
  disabled: boolean;
  webhooksLeft: boolean;
  onAdd: (step: AutomationAction) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(open, [ref], () => setOpen(false));
  const options: { key: "webhook" | "wait"; icon: LucideIcon; make: () => AutomationAction }[] = [
    ...(webhooksLeft ? [{ key: "webhook" as const, icon: Webhook, make: () => newWebhook() }] : []),
    { key: "wait", icon: Clock, make: () => newWait() },
  ];
  return (
    <div ref={ref} className="relative flex flex-col items-center">
      <div className="h-5 w-px bg-zinc-300" aria-hidden />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label={t("automations.builder.addStep")}
        title={t("automations.builder.addStep")}
        aria-expanded={open}
        className={cn(
          "grid size-7 place-items-center rounded-full border bg-white text-zinc-500 shadow-xs transition-colors disabled:opacity-40",
          open
            ? "border-brand-500 text-brand-700"
            : "border-zinc-300 hover:border-brand-400 hover:text-brand-700",
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
      <div className="h-5 w-px bg-zinc-300" aria-hidden />
      {open && (
        <div className="absolute top-12 z-20 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg">
          {options.map(({ key, icon: Icon, make }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onAdd(make());
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-50"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-zinc-900">
                  {t(`automations.builder.kinds.${key}`)}
                </span>
                <span className="block text-xs text-zinc-500">
                  {t(`automations.builder.kindHints.${key}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowNode({
  icon: Icon,
  tone,
  eyebrow,
  title,
  detail,
  selected,
  invalid,
  onClick,
  badge,
  onRemove,
  removeLabel,
}: {
  icon: LucideIcon;
  tone: "trigger" | "wait" | "webhook";
  eyebrow: string;
  title: string;
  /** A second line under the title. */
  detail?: string;
  selected: boolean;
  invalid?: boolean;
  onClick: () => void;
  badge?: ReactNode;
  /** Shows a trash button on the node's corner. */
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="group relative w-72">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left shadow-xs transition",
          selected
            ? "border-brand-500 ring-2 ring-brand-500/20"
            : invalid
              ? "border-red-300"
              : "border-zinc-200 hover:border-zinc-300",
        )}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            tone === "trigger"
              ? "bg-brand-50 text-brand-700"
              : tone === "wait"
                ? "bg-amber-50 text-amber-700"
                : "bg-sky-50 text-sky-700",
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-zinc-500">{eyebrow}</span>
          <span className="block truncate text-sm font-medium text-zinc-900">{title}</span>
          {detail && <span className="block truncate text-[13px] text-zinc-600">{detail}</span>}
        </span>
        {invalid && !selected && <CircleAlert className="size-4 text-red-500" aria-hidden />}
        {badge}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className={cn(
            "absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full border border-red-200 bg-white text-red-600 shadow-sm transition hover:bg-red-50 focus-visible:opacity-100",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** "Probar": pick an appointment (or example data) and run the whole flow now. */
function TestMenu({
  open,
  onOpenChange,
  value,
  onValue,
  running,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValue: (id: string) => void;
  running: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(open, [ref], () => onOpenChange(false));
  const placement = useMenuPlacement(open, ref, 320, "right");
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" onClick={() => onOpenChange(!open)} aria-expanded={open}>
        <Play className="size-4" aria-hidden />
        {t("automations.testRun")}
      </Button>
      {open && (
        <div
          style={placement}
          className="absolute right-0 top-11 z-30 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-zinc-200 bg-white p-4 shadow-lg"
        >
          <p className="text-sm font-medium text-zinc-900">{t("automations.testTitle")}</p>
          <p className="mt-0.5 text-[13px] text-zinc-500">{t("automations.testHint")}</p>
          <div className="mt-3 space-y-2">
            <TestAppointmentPicker value={value} onChange={onValue} />
            <Button className="w-full" loading={running} onClick={onRun}>
              <Play className="size-4" aria-hidden />
              {t("automations.builder.runTest")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  hint,
  onClose,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-zinc-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
        <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="-mr-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Minutes as an amount and a unit, edited together. */
function DurationInput({
  minutes,
  onChange,
  invalid,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [{ amount, unit }, setValue] = useState(() => splitOffset(minutes));
  const update = (next: { amount: number; unit: Unit }) => {
    setValue(next);
    onChange(Math.max(0, Math.round(next.amount * UNITS[next.unit])));
  };
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={1}
        aria-label={t("automations.amount")}
        aria-invalid={invalid || undefined}
        className="w-24"
        value={amount}
        onChange={(event) => update({ amount: Number(event.target.value), unit })}
      />
      <Select
        aria-label={t("automations.unit")}
        className="flex-1"
        value={unit}
        onChange={(event) => update({ amount, unit: event.target.value as Unit })}
      >
        {(Object.keys(UNITS) as Unit[]).map((option) => (
          <option key={option} value={option}>
            {t(`automations.units.${option}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function TriggerPanel({
  trigger,
  offsetMin,
  errors,
  onChange,
  onClose,
}: {
  trigger: AutomationTrigger | null;
  offsetMin: number;
  errors: FieldErrors;
  onChange: (change: Partial<Draft>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Zap}
        title={t("automations.whenTitle")}
        hint={t("automations.whenHint")}
        onClose={onClose}
      />
      <div className="grid gap-2">
        {TRIGGERS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={trigger === value}
            onClick={() => onChange({ trigger: value })}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              trigger === value
                ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500"
                : "border-zinc-200 hover:border-zinc-300",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
            <span>
              <span className="block text-[13px] font-medium text-zinc-900">
                {t(`automations.events.${value}`)}
              </span>
              <span className="block text-xs text-zinc-500">
                {t(`automations.eventHints.${value}`)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {isTimed(trigger) ? (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-800">
            {t("automations.howLongBefore")}
          </p>
          <DurationInput
            minutes={offsetMin}
            invalid={Boolean(errors.offsetMin)}
            onChange={(minutes) => onChange({ offsetMin: minutes })}
          />
          {errors.offsetMin && (
            <p className="mt-1 text-[13px] text-red-600">
              {fieldMessage(t, "offsetMin", errors.offsetMin)}
            </p>
          )}
          <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600">
            {t("automations.timedHint.before")}
          </p>
        </div>
      ) : (
        trigger && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600">
            {t("automations.builder.startsNow")}
          </p>
        )
      )}
    </div>
  );
}

function WaitPanel({
  minutes,
  onChange,
  onClose,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Clock}
        title={t("automations.builder.waitTitle")}
        hint={t("automations.builder.waitHint")}
        onClose={onClose}
      />
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-800">{t("automations.howLongWait")}</p>
        <DurationInput minutes={minutes} onChange={onChange} />
      </div>
      <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600">
        {t("automations.timedHint.wait")}
      </p>
    </div>
  );
}

/** With nothing selected: how to build a flow, and for saved ones their history. */
function Overview({ automation }: { automation: Automation | null }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-zinc-900">
          {t("automations.builder.howTitle")}
        </h3>
        <ol className="mt-3 space-y-2.5 text-[13px] text-zinc-600">
          {(["one", "two", "three"] as const).map((key, index) => (
            <li key={key} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">
                {index + 1}
              </span>
              {t(`automations.builder.how.${key}`)}
            </li>
          ))}
        </ol>
      </div>
      {automation && <SavedTools automation={automation} />}
    </div>
  );
}

function ResultChip({ result }: { result: AutomationStepResult | undefined }) {
  if (!result) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
        result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="size-3.5" aria-hidden />
      ) : (
        <CircleAlert className="size-3.5" aria-hidden />
      )}
      {result.status ?? "—"}
    </span>
  );
}

/** Recent and upcoming appointments to try a flow with, or example data. */
function TestAppointmentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const range = useMemo(() => {
    const now = Date.now();
    return {
      from: new Date(now - 30 * 86_400_000).toISOString(),
      to: new Date(now + 60 * 86_400_000).toISOString(),
    };
  }, []);
  const appointments = useAppointments(business.id, range);
  const when = (startsAt: string) => {
    const { date, time } = instantToZoned(Date.parse(startsAt), business.timezone);
    return `${formatDay(date, i18n.resolvedLanguage ?? "es")} ${time}`;
  };
  return (
    <Select
      aria-label={t("automations.testWith")}
      className="min-w-0 flex-1"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("automations.sampleData")}</option>
      {[...(appointments.data ?? [])]
        .reverse()
        .slice(0, 30)
        .map((appointment) => (
          <option key={appointment.id} value={appointment.id}>
            {appointment.code} · {appointment.customer.firstName} {appointment.customer.lastName} ·{" "}
            {when(appointment.startsAt)}
          </option>
        ))}
    </Select>
  );
}

function StepPanel({
  index,
  step,
  trigger,
  errors,
  result,
  testing,
  onChange,
  onTest,
  onClose,
}: {
  index: number;
  step: WebhookAction;
  trigger: AutomationTrigger;
  errors: FieldErrors;
  result: AutomationStepResult | undefined;
  testing: boolean;
  onChange: (change: Partial<WebhookAction>) => void;
  onTest: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const error = (field: string) => errors[`actions.${index}.${field}`];
  const message = step.extra.find((field) => field.name === MESSAGE)?.value ?? "";
  const others = step.extra.filter((field) => field.name !== MESSAGE);
  const setMessage = (value: string) =>
    onChange({ extra: [...(value ? [{ name: MESSAGE, value }] : []), ...others] });

  const sample = useMemo(
    () => sampleValues(business, AUTOMATION_EVENTS[trigger], i18n.resolvedLanguage ?? "es"),
    [business, trigger, i18n.resolvedLanguage],
  );
  // The body with example data, or what's wrong with a JSON written by hand.
  const preview = useMemo(() => {
    if (step.body === "json") {
      const problem = step.json.trim() ? jsonTemplateProblem(step.json) : "json_required";
      if (problem) return { problem, text: "" };
      return {
        problem: null,
        text: JSON.stringify(renderJsonTemplate(step.json, sample), null, 2),
      };
    }
    const extra = step.extra.filter((field) => field.name.trim());
    const data = fieldsBody({ fields: step.fields, extra }, sample);
    return { problem: null, text: JSON.stringify(data, null, 2) };
  }, [sample, step.body, step.json, step.fields, step.extra]);

  const toggleField = (field: AutomationField) => {
    const current = step.fields ?? [];
    onChange({
      fields: current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field],
    });
  };
  const setAuth = (type: WebhookAuth["type"]) =>
    onChange({
      auth:
        type === "basic"
          ? { type, username: "", password: "" }
          : type === "header"
            ? { type, name: "Authorization", value: "" }
            : type === "jwt"
              ? { type, secret: "" }
              : { type: "none" },
    });
  const setBody = (body: WebhookAction["body"]) => {
    // Start from what the fields send now, to reshape into the receiver's format.
    if (body === "json" && !step.json.trim()) onChange({ body, json: fieldsAsJson(step) });
    else onChange({ body });
  };
  const secretLine =
    step.auth.type === "basic"
      ? "Authorization: Basic ••••••"
      : step.auth.type === "jwt"
        ? "Authorization: Bearer <JWT>"
        : step.auth.type === "header"
          ? `${step.auth.name || "Authorization"}: ••••••`
          : null;
  const request = [
    `${step.method} ${step.url || "https://…"}`,
    ...(secretLine ? [secretLine] : []),
    ...step.headers.filter((header) => header.name.trim()).map((h) => `${h.name}: ${h.value}`),
    "Content-Type: application/json",
    "",
    preview.text || "…",
  ].join("\n");
  const jsonProblem =
    error("json") ?? (preview.problem !== "json_required" ? preview.problem : null);

  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Webhook}
        title={t("automations.step.title")}
        hint={t("automations.step.hint")}
        onClose={onClose}
      />
      <StepSection title={t("automations.step.addressTitle")} hint={t("automations.step.urlHint")}>
        <div className="flex gap-2">
          <Select
            aria-label={t("automations.step.method")}
            className="w-24 shrink-0"
            value={step.method}
            onChange={(event) =>
              onChange({ method: event.target.value as WebhookAction["method"] })
            }
          >
            {WEBHOOK_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
          <Input
            aria-label={t("automations.step.url")}
            aria-invalid={Boolean(error("url")) || undefined}
            className="min-w-0 flex-1 font-mono text-[13px]"
            value={step.url}
            placeholder={t("automations.step.urlPlaceholder")}
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </div>
        {error("url") && (
          <p className="text-[13px] text-red-600">{fieldMessage(t, "url", error("url"))}</p>
        )}
      </StepSection>

      <StepSection title={t("automations.step.authTitle")} hint={t("automations.step.authHint")}>
        <Select
          aria-label={t("automations.step.authTitle")}
          value={step.auth.type}
          onChange={(event) => setAuth(event.target.value as WebhookAuth["type"])}
        >
          {WEBHOOK_AUTH_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`automations.step.auth.${type}`)}
            </option>
          ))}
        </Select>
        {step.auth.type === "basic" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("automations.step.username")}
              error={fieldMessage(t, "required", error("auth.username"))}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={step.auth.type === "basic" ? step.auth.username : ""}
                  onChange={(event) =>
                    step.auth.type === "basic" &&
                    onChange({ auth: { ...step.auth, username: event.target.value } })
                  }
                />
              )}
            </Field>
            <Field
              label={t("automations.step.password")}
              error={fieldMessage(t, "required", error("auth.password"))}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="new-password"
                  value={step.auth.type === "basic" ? step.auth.password : ""}
                  onChange={(event) =>
                    step.auth.type === "basic" &&
                    onChange({ auth: { ...step.auth, password: event.target.value } })
                  }
                />
              )}
            </Field>
          </div>
        )}
        {step.auth.type === "header" && (
          <div className="space-y-3">
            <Field
              label={t("automations.step.headerName")}
              error={fieldMessage(t, "header", error("auth.name"))}
            >
              {(props) => (
                <Input
                  {...props}
                  className="font-mono text-[13px]"
                  value={step.auth.type === "header" ? step.auth.name : ""}
                  onChange={(event) =>
                    step.auth.type === "header" &&
                    onChange({ auth: { ...step.auth, name: event.target.value } })
                  }
                />
              )}
            </Field>
            <Field
              label={t("automations.step.headerValue")}
              hint={t("automations.step.headerValueHint")}
              error={fieldMessage(t, "required", error("auth.value"))}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="off"
                  className="font-mono text-[13px]"
                  placeholder="Bearer …"
                  value={step.auth.type === "header" ? step.auth.value : ""}
                  onChange={(event) =>
                    step.auth.type === "header" &&
                    onChange({ auth: { ...step.auth, value: event.target.value } })
                  }
                />
              )}
            </Field>
          </div>
        )}
        {step.auth.type === "jwt" && (
          <Field
            label={t("automations.step.jwtSecret")}
            hint={t("automations.step.jwtHint")}
            error={fieldMessage(t, "required", error("auth.secret"))}
          >
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="off"
                className="font-mono text-[13px]"
                value={step.auth.type === "jwt" ? step.auth.secret : ""}
                onChange={(event) =>
                  step.auth.type === "jwt" &&
                  onChange({ auth: { ...step.auth, secret: event.target.value } })
                }
              />
            )}
          </Field>
        )}
      </StepSection>

      <div className="border-t border-zinc-100 pt-4">
        <PairsEditor
          label={t("automations.headers")}
          hint={t("automations.headersHint")}
          namePlaceholder="X-Api-Key"
          valuePlaceholder="…"
          pairs={step.headers}
          onChange={(headers) => onChange({ headers })}
          addLabel={t("automations.addHeader")}
        />
      </div>

      <StepSection title={t("automations.step.bodyTitle")} hint={t("automations.step.bodyHint")}>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
          {WEBHOOK_BODY_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={step.body === mode}
              onClick={() => setBody(mode)}
              className={cn(
                "h-8 rounded-md px-3 text-[13px] font-medium transition-colors",
                step.body === mode
                  ? "bg-white text-zinc-900 shadow-xs"
                  : "text-zinc-500 hover:text-zinc-900",
              )}
            >
              {t(`automations.step.bodyModes.${mode}`)}
            </button>
          ))}
        </div>

        {step.body === "json" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-zinc-500">{t("automations.step.jsonHint")}</p>
            <TemplateEditor
              code
              objects
              place={addToJson}
              rows={12}
              sample={sample}
              aria-label={t("automations.step.bodyModes.json")}
              invalid={Boolean(jsonProblem)}
              value={step.json}
              onChange={(json) => onChange({ json })}
            />
            {jsonProblem && (
              <p className="text-[13px] text-red-600">{fieldMessage(t, "json", jsonProblem)}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-800">
                {t("automations.step.data")}
              </p>
              <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
                {(["all", "pick"] as const).map((mode) => {
                  const active = mode === "all" ? step.fields === null : step.fields !== null;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onChange({
                          fields: mode === "all" ? null : (step.fields ?? STARTER_FIELDS),
                        })
                      }
                      className={cn(
                        "h-8 rounded-md px-3 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-white text-zinc-900 shadow-xs"
                          : "text-zinc-500 hover:text-zinc-900",
                      )}
                    >
                      {t(`automations.step.dataModes.${mode}`)}
                    </button>
                  );
                })}
              </div>
              {step.fields !== null && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {AUTOMATION_GROUPS.map((group) => (
                    <fieldset key={group}>
                      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                        {t(`automations.groups.${group}`)}
                      </legend>
                      <div className="space-y-1">
                        {AUTOMATION_FIELDS[group].map((field) => (
                          <label
                            key={field}
                            className="flex items-center gap-2 text-[13px] text-zinc-700"
                          >
                            <input
                              type="checkbox"
                              className="size-4 rounded border-zinc-300 accent-brand-600"
                              checked={step.fields?.includes(field) ?? false}
                              onChange={() => toggleField(field)}
                            />
                            {t(`automations.fields.${field}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
              {error("fields") && (
                <p className="mt-1.5 text-[13px] text-red-600">
                  {fieldMessage(t, "fields", error("fields"))}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`message-${step.id}`} className="text-sm font-medium text-zinc-800">
                {t("automations.step.message")}
                <span className="ml-1.5 text-xs font-normal text-zinc-400">
                  {t("common.optional")}
                </span>
              </label>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                {t("automations.step.messageHint")}
              </p>
              <div className="mt-1.5">
                <TemplateEditor
                  id={`message-${step.id}`}
                  rows={3}
                  sample={sample}
                  value={message}
                  placeholder={t("automations.templates.reminder.message")}
                  onChange={setMessage}
                />
              </div>
              {message && (
                <p className="mt-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-[13px] text-zinc-700">
                  <span className="text-zinc-500">{t("automations.step.looksLike")} </span>
                  {renderTemplate(message, sample)}
                </p>
              )}
            </div>

            <PairsEditor
              label={t("automations.extra")}
              hint={t("automations.extraHint")}
              namePlaceholder="template"
              valuePlaceholder="recordatorio_cita"
              pairs={others}
              onChange={(list) =>
                onChange({
                  extra: [...(message ? [{ name: MESSAGE, value: message }] : []), ...list],
                })
              }
              addLabel={t("automations.addExtra")}
            />
          </div>
        )}
      </StepSection>

      <Collapsible title={t("automations.step.requestPreview")}>
        <p className="text-[13px] text-zinc-500">{t("automations.previewHint")}</p>
        <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-zinc-100 dark:bg-black dark:text-[#d4d4d8]">
          {request}
        </pre>
      </Collapsible>

      {result && <StepResult result={result} />}

      <Button variant="secondary" size="sm" loading={testing} onClick={onTest}>
        <Play className="size-4" aria-hidden />
        {t("automations.step.test")}
      </Button>
    </div>
  );
}

/** A titled part of a step's settings: address, authentication, body. */
function StepSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-zinc-100 pt-4">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
        {hint && <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Why a send failed, in plain words when the network error is a known one. */
function failureReason(t: TFunction, error: string | null): string {
  if (!error) return "";
  if (error === "internal_address") return t("automations.result.internalAddress");
  if (error === "https_required") return t("automations.result.httpsRequired");
  if (error === "timeout") return t("automations.result.timeout");
  if (error === "ECONNREFUSED") return t("automations.result.refused");
  if (error === "ENOTFOUND" || error === "EAI_AGAIN") return t("automations.result.notFound");
  if (error === "ECONNRESET") return t("automations.result.reset");
  if (/CERT|SSL|TLS/i.test(error)) return t("automations.result.certificate");
  return error;
}

/** How a step answered a test: status and time, its answer, and what was sent. */
function StepResult({ result }: { result: AutomationStepResult }) {
  const { t } = useTranslation();
  const reason = failureReason(t, result.error);
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-[13px]",
        result.ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 font-medium",
          result.ok ? "text-emerald-800" : "text-red-700",
        )}
      >
        {result.ok ? (
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        ) : (
          <CircleAlert className="size-4 shrink-0" aria-hidden />
        )}
        {result.ok
          ? t("automations.result.ok", { status: result.status, ms: result.durationMs })
          : result.status
            ? t("automations.result.httpError", { status: result.status, ms: result.durationMs })
            : t("automations.result.failed", { reason })}
      </p>
      {result.response !== null && (
        <Collapsible title={t("automations.result.response")} compact>
          <pre className="max-h-40 overflow-auto rounded-md bg-white px-2.5 py-2 font-mono text-[11.5px] break-all whitespace-pre-wrap text-zinc-700">
            {result.response || t("automations.result.emptyResponse")}
          </pre>
        </Collapsible>
      )}
      <Collapsible title={t("automations.result.sent")} compact>
        <pre className="max-h-40 overflow-auto rounded-md bg-white px-2.5 py-2 font-mono text-[11.5px] text-zinc-700">
          {JSON.stringify(result.payload, null, 2)}
        </pre>
      </Collapsible>
    </div>
  );
}

function Collapsible({
  title,
  children,
  compact,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <details className={cn("group", compact ? "mt-2" : "rounded-lg border border-zinc-200")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 font-medium text-zinc-700 select-none",
          compact ? "text-[13px]" : "px-3 py-2.5 text-sm",
        )}
      >
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        {title}
      </summary>
      <div className={cn("space-y-4", compact ? "mt-1.5" : "border-t border-zinc-100 p-3")}>
        {children}
      </div>
    </details>
  );
}

/** Name/value rows: request headers, or extra fields. */
function PairsEditor({
  label,
  hint,
  namePlaceholder,
  valuePlaceholder,
  pairs,
  onChange,
  addLabel,
}: {
  label: string;
  hint: string;
  namePlaceholder: string;
  valuePlaceholder: string;
  pairs: { name: string; value: string }[];
  onChange: (pairs: { name: string; value: string }[]) => void;
  addLabel: string;
}) {
  const { t } = useTranslation();
  const update = (index: number, change: Partial<{ name: string; value: string }>) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...change } : pair)));
  return (
    <div>
      <p className="text-sm font-medium text-zinc-800">{label}</p>
      <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
      <div className="mt-2 space-y-2">
        {pairs.map((pair, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id and don't reorder.
          <div key={index} className="flex gap-2">
            <Input
              aria-label={`${label} ${index + 1}`}
              className="w-32 shrink-0 font-mono text-[13px]"
              placeholder={namePlaceholder}
              value={pair.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Input
              aria-label={`${label} ${index + 1}: ${t("automations.value")}`}
              className="min-w-0 flex-1 text-[13px]"
              placeholder={valuePlaceholder}
              value={pair.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.delete")}
              onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...pairs, { name: "", value: "" }])}
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

/** For a saved automation: its latest sends and its signing secret. */
function SavedTools({ automation }: { automation: Automation }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const { rotateSecret } = useAutomationMutations(business.id);
  const deliveries = useAutomationDeliveries(business.id, automation.id);
  const confirm = useConfirm();
  const names = new Map(automation.actions.map((action) => [action.id, stepTitle(t, action)]));
  const time = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  return (
    <div className="space-y-3">
      <Collapsible title={t("automations.history")}>
        {deliveries.data?.length ? (
          <ul className="divide-y divide-zinc-100 text-[13px]">
            {deliveries.data.slice(0, 10).map((delivery) => (
              <li key={delivery.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-zinc-700">
                  {time(delivery.createdAt)} · {names.get(delivery.actionId ?? "") ?? "—"}
                  {delivery.payload.test ? ` · ${t("automations.testLabel")}` : ""}
                </span>
                <StatusBadge
                  status={delivery.status}
                  label={delivery.responseStatus ? String(delivery.responseStatus) : undefined}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-zinc-500">{t("automations.noHistory")}</p>
        )}
      </Collapsible>
      <Collapsible title={t("automations.security")}>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-800">{t("automations.secret")}</p>
            <Button
              variant="ghost"
              size="sm"
              loading={rotateSecret.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("automations.rotateTitle"),
                  description: t("automations.rotateBody"),
                  confirmLabel: t("automations.rotate"),
                });
                if (ok) rotateSecret.mutate(automation.id);
              }}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {t("automations.rotate")}
            </Button>
          </div>
          <CopyField value={automation.secret} label={t("automations.secret")} />
          <p className="mt-1.5 text-[12px] text-zinc-500">{t("automations.secretHint")}</p>
        </div>
      </Collapsible>
    </div>
  );
}

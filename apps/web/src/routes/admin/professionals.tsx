import { formatPrice, type ProfessionalInput, professionalSchema } from "@openturnly/core";
import { Pencil, Plus, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Checklist } from "../../components/checklist.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader, Switch } from "../../components/controls.tsx";
import { type Column, DataTable, IdentityCell } from "../../components/data-table.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Field, Input, Spinner } from "../../components/ui.tsx";
import { WeeklyHoursEditor } from "../../components/weekly-hours.tsx";
import type { Professional, WeeklyRange } from "../../lib/api.ts";
import {
  useHours,
  useProfessionalMutations,
  useProfessionals,
  useServices,
} from "../../lib/catalog.ts";
import { formatDuration } from "../../lib/format.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

export function ProfessionalsPage() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const professionals = useProfessionals(business.id);
  const services = useServices(business.id);
  // The form starts from the current hours, so wait for them before opening it.
  const hours = useHours(business.id);
  const [editing, setEditing] = useState<Professional | "new" | null>(null);

  const serviceNames = new Map(services.data?.map((service) => [service.id, service.name]));

  const newButton = (
    <Button data-tour="professionals-new" onClick={() => setEditing("new")}>
      <Plus className="size-4" aria-hidden />
      {t("professionals.new")}
    </Button>
  );

  const columns: Column<Professional>[] = [
    {
      key: "name",
      header: t("professionals.colProfessional"),
      cell: (professional) => (
        <IdentityCell initial={professional.name} title={professional.name} />
      ),
    },
    {
      key: "services",
      header: t("professionals.colServices"),
      className: "hidden md:table-cell",
      cell: (professional) => {
        const names = professional.serviceIds
          .map((id) => serviceNames.get(id))
          .filter((name): name is string => Boolean(name));
        return (
          <span className="block max-w-xs truncate text-zinc-600" title={names.join(", ")}>
            {names.length <= 2
              ? names.join(", ") || "—"
              : t("professionals.servicesCount", { count: names.length })}
          </span>
        );
      },
    },
    {
      key: "hours",
      header: t("professionals.colHours"),
      className: "hidden sm:table-cell",
      cell: (professional) => (
        <span className="text-zinc-600">
          {professional.hasOwnHours
            ? t("professionals.ownHours")
            : t("professionals.businessHours")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("professionals.colStatus"),
      cell: (professional) =>
        professional.active ? (
          <Badge tone="success">{t("professionals.available")}</Badge>
        ) : (
          <Badge>{t("professionals.unavailable")}</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: () => (
        <span className="inline-grid size-8 place-items-center rounded-md text-zinc-400">
          <Pencil className="size-4" aria-hidden />
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("professionals.title")}
        subtitle={t("professionals.subtitle")}
        actions={newButton}
      />
      {professionals.isPending ? (
        <Spinner />
      ) : professionals.isError ? (
        <Alert>{errorMessage(t, professionals.error)}</Alert>
      ) : professionals.data.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" aria-hidden />}
          title={t("professionals.emptyTitle")}
          body={t("professionals.emptyBody")}
          action={newButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={professionals.data}
          rowKey={(professional) => professional.id}
          onRowClick={setEditing}
          searchPlaceholder={t("professionals.search")}
          matches={(professional, query) => professional.name.toLowerCase().includes(query)}
          empty={t("professionals.emptyTitle")}
        />
      )}
      {editing && services.data && hours.data && (
        <ProfessionalForm
          professional={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProfessionalForm({
  professional,
  onClose,
}: {
  professional: Professional | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const services = useServices(business.id);
  const hours = useHours(business.id);
  const { save, remove } = useProfessionalMutations(business.id);
  const confirm = useConfirm();

  const [name, setName] = useState(professional?.name ?? "");
  const [active, setActive] = useState(professional?.active ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(
    professional?.serviceIds ?? services.data?.map((service) => service.id) ?? [],
  );
  const ownHours = professional ? (hours.data?.professionals[professional.id] ?? []) : [];
  const [customHours, setCustomHours] = useState(ownHours.length > 0);
  const [weekly, setWeekly] = useState<WeeklyRange[]>(
    ownHours.length > 0 ? ownHours : (hours.data?.business ?? []),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values: ProfessionalInput = { name, active, serviceIds };
    const result = validate(professionalSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      { id: professional?.id, input: result.data, hours: customHours ? weekly : [] },
      {
        onSuccess: () => {
          toast.success(professional ? t("common.saved") : t("professionals.created"));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={professional ? t("professionals.edit") : t("professionals.new")}
      footer={
        <>
          {professional && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("professionals.deleteTitle", { name: professional.name }),
                  description: t("professionals.deleteBody"),
                  confirmLabel: t("common.delete"),
                  tone: "danger",
                });
                if (ok) {
                  remove.mutate(professional.id, {
                    onSuccess: () => {
                      toast.success(t("professionals.deleted"));
                      onClose();
                    },
                  });
                }
              }}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="professional-form" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="professional-form" onSubmit={submit} noValidate className="space-y-4">
        {(save.isError || remove.isError) && (
          <Alert>{errorMessage(t, save.error ?? remove.error)}</Alert>
        )}
        <Field label={t("fields.name")} error={fieldMessage(t, "name", errors.name)}>
          {(props) => (
            <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-800">
            {t("professionals.servicesLabel")}
          </legend>
          {services.data?.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {t("professionals.noServices")}{" "}
              <Link to="../services" className="font-medium text-brand-700 hover:underline">
                {t("nav.services")}
              </Link>
            </p>
          ) : (
            <Checklist
              label={t("professionals.servicesLabel")}
              value={serviceIds}
              onChange={setServiceIds}
              items={(services.data ?? []).map((service) => ({
                id: service.id,
                label: service.name,
                detail: `${formatDuration(service.durationMin)} · ${
                  service.priceAmount === null
                    ? t("services.priceOnRequest")
                    : formatPrice(service.priceAmount, business.currency)
                }`,
              }))}
            />
          )}
        </fieldset>

        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          <div className="space-y-3 py-4">
            <Switch
              checked={customHours}
              onChange={setCustomHours}
              label={t("professionals.customHours")}
              description={t("professionals.customHoursHint")}
            />
            {customHours && <WeeklyHoursEditor value={weekly} onChange={setWeekly} />}
          </div>
          <div className="pt-4">
            <Switch
              checked={active}
              onChange={setActive}
              label={t("professionals.active")}
              description={t("professionals.activeHint")}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

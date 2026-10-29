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
  type LocationHours,
  useHoursAt,
  useLocations,
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
  const locations = useLocations(business.id);
  // The form starts from the current hours at each location, so wait for them.
  const hours = useHoursAt(business.id, locations.data?.map((location) => location.id) ?? []);
  const [editing, setEditing] = useState<Professional | "new" | null>(null);

  const serviceNames = new Map(services.data?.map((service) => [service.id, service.name]));
  const locationNames = new Map(locations.data?.map((location) => [location.id, location.name]));
  const severalLocations = (locations.data?.length ?? 0) > 1;

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
    ...(severalLocations
      ? [
          {
            key: "locations",
            header: t("professionals.colLocations"),
            className: "hidden lg:table-cell",
            cell: (professional: Professional) => {
              const names = professional.locationIds
                .map((id) => locationNames.get(id))
                .filter((name): name is string => Boolean(name));
              return (
                <span className="block max-w-xs truncate text-zinc-600" title={names.join(", ")}>
                  {names.join(", ") || "—"}
                </span>
              );
            },
          },
        ]
      : []),
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
      {editing && services.data && locations.data && hours && (
        <ProfessionalForm
          professional={editing === "new" ? null : editing}
          hours={hours}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProfessionalForm({
  professional,
  hours,
  onClose,
}: {
  professional: Professional | null;
  /** Hours at every location of the business. */
  hours: Record<string, LocationHours>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const services = useServices(business.id);
  const locations = useLocations(business.id).data ?? [];
  const severalLocations = locations.length > 1;
  const { save, remove } = useProfessionalMutations(business.id);
  const confirm = useConfirm();

  const [name, setName] = useState(professional?.name ?? "");
  const [active, setActive] = useState(professional?.active ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(
    professional?.serviceIds ?? services.data?.map((service) => service.id) ?? [],
  );
  const [locationIds, setLocationIds] = useState<string[]>(
    professional?.locationIds ?? locations.map((location) => location.id),
  );
  /** Their own hours at a location, or none when they follow the location's. */
  const ownAt = (locationId: string) =>
    (professional && hours[locationId]?.professionals[professional.id]) || [];
  const [customHours, setCustomHours] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(locations.map((location) => [location.id, ownAt(location.id).length > 0])),
  );
  const [weekly, setWeekly] = useState<Record<string, WeeklyRange[]>>(() =>
    Object.fromEntries(
      locations.map((location) => {
        const own = ownAt(location.id);
        return [location.id, own.length > 0 ? own : (hours[location.id]?.business ?? [])];
      }),
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const workplaces = locations.filter((location) => locationIds.includes(location.id));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values: ProfessionalInput = { name, active, serviceIds, locationIds };
    const result = validate(professionalSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      {
        id: professional?.id,
        input: result.data,
        hours: Object.fromEntries(
          workplaces.map((location) => [
            location.id,
            customHours[location.id] ? (weekly[location.id] ?? []) : [],
          ]),
        ),
      },
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

        {severalLocations && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">
              {t("professionals.locationsLabel")}
            </legend>
            <Checklist
              label={t("professionals.locationsLabel")}
              value={locationIds}
              onChange={setLocationIds}
              items={locations.map((location) => ({
                id: location.id,
                label: location.name,
                detail: location.address ?? undefined,
              }))}
            />
          </fieldset>
        )}

        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          {workplaces.map((location) => (
            <div key={location.id} className="space-y-3 py-4">
              <Switch
                checked={customHours[location.id] ?? false}
                onChange={(on) => setCustomHours((current) => ({ ...current, [location.id]: on }))}
                label={
                  severalLocations
                    ? t("professionals.ownHoursAt", { name: location.name })
                    : t("professionals.customHours")
                }
                description={
                  severalLocations
                    ? t("professionals.ownHoursAtHint")
                    : t("professionals.customHoursHint")
                }
              />
              {customHours[location.id] && (
                <WeeklyHoursEditor
                  value={weekly[location.id] ?? []}
                  onChange={(value) =>
                    setWeekly((current) => ({ ...current, [location.id]: value }))
                  }
                />
              )}
            </div>
          ))}
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

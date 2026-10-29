import { type LocationInput, locationSchema } from "@openturnly/core";
import { MapPin, Pencil, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checklist } from "../../components/checklist.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader, Switch } from "../../components/controls.tsx";
import { type Column, DataTable, IdentityCell } from "../../components/data-table.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Field, Input, Spinner } from "../../components/ui.tsx";
import type { Location } from "../../lib/api.ts";
import {
  useLocationMutations,
  useLocations,
  useProfessionals,
  useServices,
} from "../../lib/catalog.ts";
import { formatDuration } from "../../lib/format.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

export function LocationsPage() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const locations = useLocations(business.id);
  const services = useServices(business.id);
  const professionals = useProfessionals(business.id);
  const [editing, setEditing] = useState<Location | "new" | null>(null);

  const newButton = (
    <Button data-tour="locations-new" onClick={() => setEditing("new")}>
      <Plus className="size-4" aria-hidden />
      {t("locations.new")}
    </Button>
  );

  const columns: Column<Location>[] = [
    {
      key: "name",
      header: t("locations.colLocation"),
      cell: (location) => (
        <IdentityCell
          initial={location.name}
          title={location.name}
          subtitle={location.address ?? undefined}
        />
      ),
    },
    {
      key: "services",
      header: t("locations.colServices"),
      className: "hidden md:table-cell",
      cell: (location) => (
        <span className="text-zinc-600 tabular-nums">
          {t("locations.servicesCount", { count: location.serviceIds.length })}
        </span>
      ),
    },
    {
      key: "team",
      header: t("locations.colTeam"),
      className: "hidden sm:table-cell",
      phone: true,
      cell: (location) => (
        <span className="text-zinc-600 tabular-nums">
          {location.resourceIds.length === 0
            ? t("locations.noTeam")
            : t("locations.teamCount", { count: location.resourceIds.length })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("locations.colStatus"),
      cell: (location) =>
        location.active ? (
          <Badge tone="success">{t("locations.active")}</Badge>
        ) : (
          <Badge>{t("locations.inactive")}</Badge>
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
        title={t("locations.title")}
        subtitle={t("locations.subtitle")}
        actions={newButton}
      />
      {locations.isPending ? (
        <Spinner />
      ) : locations.isError ? (
        <Alert>{errorMessage(t, locations.error)}</Alert>
      ) : locations.data.length === 0 ? (
        <EmptyState
          icon={<MapPin className="size-5" aria-hidden />}
          title={t("locations.emptyTitle")}
          body={t("locations.emptyBody")}
          action={newButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={locations.data}
          rowKey={(location) => location.id}
          onRowClick={setEditing}
          searchPlaceholder={t("locations.search")}
          matches={(location, query) =>
            `${location.name} ${location.address ?? ""}`.toLowerCase().includes(query)
          }
          empty={t("locations.emptyTitle")}
        />
      )}
      {editing && services.data && professionals.data && (
        <LocationForm
          location={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function LocationForm({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const services = useServices(business.id);
  const professionals = useProfessionals(business.id);
  const { save, remove } = useLocationMutations(business.id);
  const confirm = useConfirm();

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [phone, setPhone] = useState(location?.phone ?? "");
  const [active, setActive] = useState(location?.active ?? true);
  // A new location starts with every service and nobody: people are added as they move in.
  const [serviceIds, setServiceIds] = useState<string[]>(
    location?.serviceIds ?? services.data?.map((service) => service.id) ?? [],
  );
  const [resourceIds, setResourceIds] = useState<string[]>(location?.resourceIds ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values: LocationInput = { name, address, phone, active, serviceIds, resourceIds };
    const result = validate(locationSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      { id: location?.id, input: result.data },
      {
        onSuccess: () => {
          toast.success(location ? t("common.saved") : t("locations.created"));
          onClose();
        },
      },
    );
  };

  const removeLocation = async () => {
    if (!location) return;
    if (location.appointmentCount > 0) {
      toast.error(t("errors.location_in_use"));
      return;
    }
    const ok = await confirm({
      title: t("locations.deleteTitle", { name: location.name }),
      description: t("locations.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) {
      remove.mutate(location.id, {
        onSuccess: () => {
          toast.success(t("locations.deleted"));
          onClose();
        },
      });
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={location ? t("locations.edit") : t("locations.new")}
      footer={
        <>
          {location && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={removeLocation}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="location-form" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={submit} noValidate className="space-y-4">
        {(save.isError || remove.isError) && (
          <Alert>{errorMessage(t, save.error ?? remove.error)}</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.name")} error={fieldMessage(t, "name", errors.name)}>
            {(props) => (
              <Input
                {...props}
                placeholder={t("locations.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("fields.phone")} optional error={fieldMessage(t, "phone", errors.phone)}>
            {(props) => (
              <Input
                {...props}
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("fields.address")} optional>
          {(props) => (
            <Input
              {...props}
              placeholder={t("locations.addressPlaceholder")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-6 border-t border-zinc-100 pt-4 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">
              {t("locations.servicesLabel")}
            </legend>
            {services.data?.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("professionals.noServices")}</p>
            ) : (
              <Checklist
                label={t("locations.servicesLabel")}
                value={serviceIds}
                onChange={setServiceIds}
                items={(services.data ?? []).map((service) => ({
                  id: service.id,
                  label: service.name,
                  detail: formatDuration(service.durationMin),
                }))}
              />
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">
              {t("locations.teamLabel")}
            </legend>
            {professionals.data?.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("locations.noProfessionals")}</p>
            ) : (
              <Checklist
                label={t("locations.teamLabel")}
                value={resourceIds}
                onChange={setResourceIds}
                items={(professionals.data ?? []).map((professional) => ({
                  id: professional.id,
                  label: professional.name,
                }))}
              />
            )}
            <p className="text-[13px] text-zinc-500">{t("locations.teamHint")}</p>
          </fieldset>
        </div>

        <div className="border-t border-zinc-100 pt-4">
          <Switch
            checked={active}
            onChange={setActive}
            label={t("locations.activeLabel")}
            description={t("locations.activeHint")}
          />
        </div>
      </form>
    </Modal>
  );
}

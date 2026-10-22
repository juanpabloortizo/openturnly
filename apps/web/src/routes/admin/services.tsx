import { formatPrice, fromMinorUnits, serviceSchema, toMinorUnits } from "@openturnly/core";
import { Pencil, Plus, Scissors } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader, Switch } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { toast } from "../../components/toast.tsx";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "../../components/ui.tsx";
import type { Service } from "../../lib/api.ts";
import { useServiceMutations, useServices } from "../../lib/catalog.ts";
import { currencySymbol, formatDuration } from "../../lib/format.ts";
import { errorMessage, type FieldErrors, fieldMessage, validate } from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

export function ServicesPage() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const services = useServices(business.id);
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  const newButton = (
    <Button data-tour="services-new" onClick={() => setEditing("new")}>
      <Plus className="size-4" aria-hidden />
      {t("services.new")}
    </Button>
  );

  const columns: Column<Service>[] = [
    {
      key: "name",
      header: t("services.colService"),
      cell: (service) => (
        <div className="min-w-0 max-w-md">
          <div className="truncate font-medium text-zinc-900">{service.name}</div>
          {service.description && (
            <div className="truncate text-[13px] text-zinc-500">{service.description}</div>
          )}
        </div>
      ),
    },
    {
      key: "duration",
      header: t("services.colDuration"),
      className: "hidden sm:table-cell whitespace-nowrap",
      phone: true,
      cell: (service) => (
        <span className="text-zinc-600">{formatDuration(service.durationMin)}</span>
      ),
    },
    {
      key: "price",
      header: t("services.colPrice"),
      className: "whitespace-nowrap",
      cell: (service) =>
        service.priceAmount === null ? (
          <span className="text-zinc-500">{t("services.priceOnRequest")}</span>
        ) : (
          <span className="font-medium text-zinc-900 tabular-nums">
            {formatPrice(service.priceAmount, business.currency)}
          </span>
        ),
    },
    {
      key: "status",
      header: t("services.colStatus"),
      className: "hidden md:table-cell",
      cell: (service) =>
        service.active ? (
          <Badge tone="success">{t("services.visible")}</Badge>
        ) : (
          <Badge>{t("services.hidden")}</Badge>
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
        title={t("services.title")}
        subtitle={t("services.subtitle")}
        actions={newButton}
      />
      {services.isPending ? (
        <Spinner />
      ) : services.isError ? (
        <Alert>{errorMessage(t, services.error)}</Alert>
      ) : services.data.length === 0 ? (
        <EmptyState
          icon={<Scissors className="size-5" aria-hidden />}
          title={t("services.emptyTitle")}
          body={t("services.emptyBody")}
          action={newButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={services.data}
          rowKey={(service) => service.id}
          onRowClick={setEditing}
          searchPlaceholder={t("services.search")}
          matches={(service, query) => service.name.toLowerCase().includes(query)}
          empty={t("services.emptyTitle")}
        />
      )}
      {editing && (
        <ServiceForm
          service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

const DURATIONS = [10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];

function ServiceForm({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const { save, remove } = useServiceMutations(business.id);
  const confirm = useConfirm();
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [durationMin, setDurationMin] = useState(service?.durationMin ?? 30);
  const [price, setPrice] = useState(
    service?.priceAmount != null
      ? String(fromMinorUnits(service.priceAmount, business.currency))
      : "",
  );
  const [active, setActive] = useState(service?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(price.replace(",", "."));
    const values = {
      name,
      description,
      durationMin,
      // Empty or unreadable fails validation: every service shows its price.
      priceAmount:
        price.trim() === "" || Number.isNaN(amount)
          ? undefined
          : toMinorUnits(amount, business.currency),
      active,
    };
    const result = validate(serviceSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      { id: service?.id, input: result.data },
      {
        onSuccess: () => {
          toast.success(service ? t("common.saved") : t("services.created"));
          onClose();
        },
      },
    );
  };

  const durations = DURATIONS.includes(durationMin)
    ? DURATIONS
    : [...DURATIONS, durationMin].sort((a, b) => a - b);

  return (
    <Modal
      open
      onClose={onClose}
      title={service ? t("services.edit") : t("services.new")}
      footer={
        <>
          {service && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("services.deleteTitle", { name: service.name }),
                  description: t("services.deleteBody"),
                  confirmLabel: t("common.delete"),
                  tone: "danger",
                });
                if (ok) {
                  remove.mutate(service.id, {
                    onSuccess: () => {
                      toast.success(t("services.deleted"));
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
          <Button type="submit" form="service-form" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} noValidate className="space-y-4">
        {(save.isError || remove.isError) && (
          <Alert>{errorMessage(t, save.error ?? remove.error)}</Alert>
        )}
        <Field label={t("fields.serviceName")} error={fieldMessage(t, "name", errors.name)}>
          {(props) => (
            <Input
              {...props}
              placeholder={t("services.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("fields.duration")}>
            {(props) => (
              <Select
                {...props}
                value={durationMin}
                onChange={(event) => setDurationMin(Number(event.target.value))}
              >
                {durations.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatDuration(minutes)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("fields.price")}
            error={fieldMessage(t, "priceAmount", errors.priceAmount)}
          >
            {(props) => (
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
                  {currencySymbol(business.currency, i18n.resolvedLanguage ?? "es")}
                </span>
                <Input
                  {...props}
                  inputMode="decimal"
                  placeholder="0"
                  className="pr-12 pl-8 tabular-nums"
                  value={price}
                  onChange={(event) => setPrice(event.target.value.replace(/[^\d.,]/g, ""))}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
                  {business.currency}
                </span>
              </div>
            )}
          </Field>
        </div>
        <Field label={t("fields.description")} optional>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              className="min-h-0"
              placeholder={t("services.descriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <div className="border-t border-zinc-100 pt-4">
          <Switch
            checked={active}
            onChange={setActive}
            label={t("services.active")}
            description={t("services.activeHint")}
          />
        </div>
      </form>
    </Modal>
  );
}

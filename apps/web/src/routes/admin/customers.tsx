import { customerAdminSchema, formatPhone, formatPrice, instantToZoned } from "@openturnly/core";
import { CalendarDays, Contact, Merge, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Combobox, searchable } from "../../components/combobox.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { EmptyState, Modal, PageHeader } from "../../components/controls.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { PhoneInput } from "../../components/phone-input.tsx";
import { toast } from "../../components/toast.tsx";
import { Alert, Badge, Button, Field, Input, Spinner, Textarea } from "../../components/ui.tsx";
import type { Customer, CustomerAppointment, CustomerSummary } from "../../lib/api.ts";
import { useCustomer, useCustomerMutations, useCustomers } from "../../lib/customers.ts";
import {
  apiFieldErrors,
  errorMessage,
  type FieldErrors,
  fieldMessage,
  validate,
} from "../../lib/forms.ts";
import { useBusinessContext } from "./business.tsx";

function initials(customer: { firstName: string; lastName: string }) {
  return `${customer.firstName.charAt(0)}${customer.lastName.charAt(0)}`.toUpperCase();
}

/** "24 oct 2026, 09:00" in the business's time zone. */
function useFormatInstant() {
  const { i18n } = useTranslation();
  const { business } = useBusinessContext();
  return (iso: string, withTime = true) => {
    const { date, time } = instantToZoned(Date.parse(iso), business.timezone);
    const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
    return withTime ? `${day}, ${time}` : day;
  };
}

export function CustomersPage() {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const customers = useCustomers(business.id);
  const formatInstant = useFormatInstant();
  // ?customer=<id> opens a customer, so the agenda can link straight to one.
  const [params, setParams] = useSearchParams();
  const openId = params.get("customer");
  const [creating, setCreating] = useState(false);

  const open = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("customer", id);
        else next.delete("customer");
        return next;
      },
      { replace: true },
    );

  const newButton = (
    <Button data-tour="customers-new" onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden />
      {t("customers.new")}
    </Button>
  );

  const columns: Column<CustomerSummary>[] = [
    {
      key: "name",
      header: t("customers.colCustomer"),
      cell: (customer) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">
            {initials(customer)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-zinc-900">
              {customer.firstName} {customer.lastName}
            </div>
            <div className="truncate text-[13px] text-zinc-500">
              {customer.email ?? (customer.phone ? formatPhone(customer.phone) : "—")}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("customers.colPhone"),
      className: "hidden md:table-cell whitespace-nowrap",
      cell: (customer) => (
        <span className="text-zinc-600 tabular-nums">
          {customer.phone ? formatPhone(customer.phone) : "—"}
        </span>
      ),
    },
    {
      key: "visits",
      header: t("customers.colVisits"),
      className: "w-24 text-right",
      cell: (customer) => (
        <span className="font-medium text-zinc-900 tabular-nums">{customer.visits}</span>
      ),
    },
    {
      key: "last",
      header: t("customers.colLastVisit"),
      className: "hidden lg:table-cell whitespace-nowrap",
      cell: (customer) => (
        <span className="text-zinc-600">
          {customer.lastVisit ? formatInstant(customer.lastVisit, false) : "—"}
        </span>
      ),
    },
    {
      key: "next",
      header: t("customers.colNextVisit"),
      className: "hidden sm:table-cell whitespace-nowrap",
      phone: true,
      cell: (customer) =>
        customer.nextVisit ? (
          <Badge tone="brand">{formatInstant(customer.nextVisit)}</Badge>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        subtitle={t("customers.subtitle")}
        actions={newButton}
      />
      <div data-tour="customers-list">
        {customers.isPending ? (
          <Spinner />
        ) : customers.isError ? (
          <Alert>{errorMessage(t, customers.error)}</Alert>
        ) : customers.data.length === 0 ? (
          <EmptyState
            icon={<Contact className="size-5" aria-hidden />}
            title={t("customers.emptyTitle")}
            body={t("customers.emptyBody")}
            action={newButton}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={customers.data}
            rowKey={(customer) => customer.id}
            onRowClick={(customer) => open(customer.id)}
            searchPlaceholder={t("customers.search")}
            matches={(customer, query) =>
              searchable(
                `${customer.firstName} ${customer.lastName} ${customer.email ?? ""} ${customer.phone ?? ""}`,
              ).includes(searchable(query.replace(/\s+/g, " ")))
            }
            empty={t("customers.emptyTitle")}
            pageSize={15}
          />
        )}
      </div>
      {creating && <CustomerForm customer={null} onClose={() => setCreating(false)} />}
      {openId && <CustomerDetails customerId={openId} onClose={() => open(null)} />}
    </>
  );
}

/** A customer's details and history; loads them, then shows the editable form. */
function CustomerDetails({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const detail = useCustomer(business.id, customerId);
  const all = useCustomers(business.id);
  // A stale link (deleted customer, another business) just closes with a message.
  useEffect(() => {
    if (detail.isError) {
      toast.error(errorMessage(t, detail.error));
      onClose();
    }
  }, [detail.isError, detail.error, onClose, t]);
  if (!detail.data) return null;
  return (
    <CustomerForm
      // A merge brings in more history; start the form again from the saved record.
      key={detail.data.customer.updatedAt}
      customer={detail.data.customer}
      history={detail.data.appointments}
      others={(all.data ?? []).filter((other) => other.id !== customerId)}
      onClose={onClose}
    />
  );
}

function CustomerForm({
  customer,
  history = [],
  others = [],
  onClose,
}: {
  customer: Customer | null;
  history?: CustomerAppointment[];
  /** Every other customer, to spot and merge duplicates. */
  others?: CustomerSummary[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const { save, remove } = useCustomerMutations(business.id);
  const confirm = useConfirm();
  const [values, setValues] = useState({
    firstName: customer?.firstName ?? "",
    lastName: customer?.lastName ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    notes: customer?.notes ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (field: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(customerAdminSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate(
      { id: customer?.id, input: result.data },
      {
        onSuccess: () => {
          toast.success(customer ? t("common.saved") : t("customers.created"));
          onClose();
        },
        onError: (error) => setErrors(apiFieldErrors(error)),
      },
    );
  };

  const deleteCustomer = async () => {
    if (!customer) return;
    const ok = await confirm({
      title: t("customers.deleteTitle", { name: `${customer.firstName} ${customer.lastName}` }),
      description: t("customers.deleteBody", { count: history.length }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(customer.id, {
      onSuccess: () => {
        toast.success(t("customers.deleted"));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  const form = (
    <form id="customer-form" onSubmit={submit} noValidate className="space-y-4">
      {save.isError && !Object.keys(apiFieldErrors(save.error)).length && (
        <Alert>{errorMessage(t, save.error)}</Alert>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("booking.firstName")} error={fieldMessage(t, "name", errors.firstName)}>
          {(props) => (
            <Input
              {...props}
              value={values.firstName}
              onChange={(event) => set("firstName", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("booking.lastName")} error={fieldMessage(t, "name", errors.lastName)}>
          {(props) => (
            <Input
              {...props}
              value={values.lastName}
              onChange={(event) => set("lastName", event.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="-mb-1 text-[13px] text-zinc-500">{t("customers.contactHint")}</p>
      <Field label={t("booking.phone")} error={fieldMessage(t, "phone", errors.phone)}>
        {(props) => (
          <PhoneInput
            id={props.id}
            invalid={Boolean(errors.phone)}
            value={values.phone}
            onChange={(phone) => set("phone", phone)}
            defaultCountry={business.country}
            locale={i18n.resolvedLanguage ?? "es"}
            searchPlaceholder={t("booking.searchCountry")}
          />
        )}
      </Field>
      <Field label={t("booking.email")} error={fieldMessage(t, "email", errors.email)}>
        {(props) => (
          <Input
            {...props}
            type="email"
            value={values.email}
            onChange={(event) => set("email", event.target.value)}
          />
        )}
      </Field>
      <Field label={t("customers.notes")} optional hint={t("customers.notesHint")}>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        )}
      </Field>
    </form>
  );

  return (
    <Modal
      open
      wide={customer !== null}
      onClose={onClose}
      title={customer ? `${customer.firstName} ${customer.lastName}` : t("customers.new")}
      description={
        customer
          ? t("customers.since", {
              date: new Date(customer.createdAt).toLocaleDateString(i18n.resolvedLanguage, {
                month: "long",
                year: "numeric",
              }),
            })
          : undefined
      }
      footer={
        <>
          {customer && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              loading={remove.isPending}
              onClick={deleteCustomer}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="customer-form" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      {customer ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">{form}</div>
          <div className="min-w-0 space-y-4 md:border-l md:border-zinc-100 md:pl-6">
            <Duplicates customer={customer} others={others} />
            <History history={history} />
          </div>
        </div>
      ) : (
        form
      )}
    </Modal>
  );
}

function History({ history }: { history: CustomerAppointment[] }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const formatInstant = useFormatInstant();
  const now = Date.now();
  const done = history.filter(
    (appointment) => appointment.status === "confirmed" && Date.parse(appointment.startsAt) <= now,
  );
  const spent = done.reduce((total, appointment) => total + (appointment.priceAmount ?? 0), 0);

  return (
    <section className="min-w-0 space-y-3">
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-50 px-3 py-2.5">
          <dt className="text-xs text-zinc-500">{t("customers.visitsDone")}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-zinc-900 tabular-nums">{done.length}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2.5">
          <dt className="text-xs text-zinc-500">{t("customers.spent")}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-zinc-900 tabular-nums">
            {formatPrice(spent, business.currency)}
          </dd>
        </div>
      </dl>
      <h3 className="pt-1 text-sm font-semibold text-zinc-900">{t("customers.history")}</h3>
      {history.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500">
          {t("customers.noHistory")}
        </p>
      ) : (
        <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {history.map((appointment) => {
            const upcoming = Date.parse(appointment.startsAt) > now;
            const cancelled = appointment.status === "cancelled";
            return (
              <li
                key={appointment.id}
                className="rounded-lg border border-zinc-200 px-3 py-2.5 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={
                        cancelled
                          ? "truncate text-zinc-400 line-through"
                          : "truncate font-medium text-zinc-900"
                      }
                    >
                      {appointment.serviceName}
                      {appointment.resourceName && (
                        <span className="font-normal text-zinc-500">
                          {" "}
                          · {appointment.resourceName}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-zinc-500">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {formatInstant(appointment.startsAt)}
                    </p>
                  </div>
                  {cancelled ? (
                    <Badge>{t("customers.cancelled")}</Badge>
                  ) : upcoming ? (
                    <Badge tone="brand">{t("customers.upcoming")}</Badge>
                  ) : (
                    <Badge tone="success">{t("customers.done")}</Badge>
                  )}
                </div>
                {appointment.answers.length > 0 && (
                  <dl className="mt-2 space-y-0.5 text-[13px]">
                    {appointment.answers.map((answer) => (
                      <div key={answer.id} className="flex gap-1.5">
                        <dt className="text-zinc-500">{answer.label}:</dt>
                        <dd className="text-zinc-800">{answer.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-1.5 font-mono text-xs tracking-wider text-zinc-400">
                  {appointment.code}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Other customers that look like the same person (same phone, email or name), each with a
 * button to bring them into this one; any other customer can be picked too.
 */
function Duplicates({ customer, others }: { customer: Customer; others: CustomerSummary[] }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const { merge } = useCustomerMutations(business.id);
  const confirm = useConfirm();
  const [picking, setPicking] = useState(false);
  const fullName = (person: { firstName: string; lastName: string }) =>
    `${person.firstName} ${person.lastName}`;
  // Two records can share a name; the contact tells them apart in the confirmation.
  const describe = (person: Customer | CustomerSummary) => {
    const contact = person.phone ? formatPhone(person.phone) : person.email;
    return contact ? `${fullName(person)} (${contact})` : fullName(person);
  };
  const sameName = searchable(fullName(customer));

  const reasons = (other: CustomerSummary) =>
    [
      customer.phone && other.phone === customer.phone && t("customers.samePhone"),
      customer.email && other.email === customer.email && t("customers.sameEmail"),
      searchable(fullName(other)) === sameName && t("customers.sameName"),
    ].filter(Boolean);
  const likely = others.filter((other) => reasons(other).length > 0);

  const mergeIn = async (other: CustomerSummary) => {
    const ok = await confirm({
      title: t("customers.mergeTitle"),
      description: t("customers.mergeBody", { other: describe(other), name: describe(customer) }),
      confirmLabel: t("customers.merge"),
    });
    if (!ok) return;
    merge.mutate(
      { id: other.id, intoId: customer.id },
      {
        onSuccess: () => {
          toast.success(t("customers.merged"));
          setPicking(false);
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );
  };

  return (
    <div className="space-y-2">
      {likely.map((other) => (
        <div
          key={other.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px]"
        >
          <div className="min-w-0">
            <p className="font-medium text-amber-900">
              {t("customers.maybeDuplicate", { name: fullName(other) })}
            </p>
            <p className="text-amber-800/80">{reasons(other).join(" · ")}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => mergeIn(other)}>
            <Merge className="size-3.5" aria-hidden />
            {t("customers.merge")}
          </Button>
        </div>
      ))}
      {picking ? (
        <Combobox
          value=""
          onChange={(id) => {
            const other = others.find((candidate) => candidate.id === id);
            if (other) mergeIn(other);
          }}
          options={others.map((other) => ({
            value: other.id,
            label: fullName(other),
            detail: other.phone ? formatPhone(other.phone) : (other.email ?? undefined),
            keywords: `${other.email ?? ""} ${other.phone ?? ""}`,
          }))}
          searchPlaceholder={t("customers.search")}
          emptyText={t("table.noResults")}
          placeholder={t("customers.mergePick")}
        />
      ) : (
        others.length > 0 && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-800"
          >
            <Merge className="size-3.5" aria-hidden />
            {t("customers.mergeOther")}
          </button>
        )
      )}
    </div>
  );
}

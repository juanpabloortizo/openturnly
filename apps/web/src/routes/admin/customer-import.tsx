import { formatPhone, instantToZoned, MAX_IMPORT_ROWS } from "@openturnly/core";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchable, useClickOutside, useMenuPlacement } from "../../components/combobox.tsx";
import { Modal } from "../../components/controls.tsx";
import { toast } from "../../components/toast.tsx";
import { Button, Field, Select } from "../../components/ui.tsx";
import type { CustomerSummary } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useImportCustomers } from "../../lib/customers.ts";
import { type Cell, downloadCsv, downloadXlsx } from "../../lib/export.ts";
import { errorMessage } from "../../lib/forms.ts";
import { readSpreadsheet } from "../../lib/spreadsheet.ts";
import { useBusinessContext } from "./business.tsx";

const FIELDS = ["firstName", "lastName", "phone", "email", "notes"] as const;
type ImportField = (typeof FIELDS)[number];
type Mapping = Record<ImportField, number | null>;

/** Header names each field is recognised by, in Spanish and English. */
const HEADERS: Record<ImportField | "fullName", string[]> = {
  fullName: ["nombre completo", "full name", "cliente", "customer"],
  firstName: ["nombre", "nombres", "first name", "firstname", "name", "given name"],
  lastName: ["apellido", "apellidos", "last name", "lastname", "surname", "family name"],
  phone: ["celular", "telefono", "movil", "phone", "mobile", "whatsapp", "cel", "numero"],
  email: ["email", "correo", "e-mail", "mail", "correo electronico"],
  notes: ["notas", "nota", "notes", "observaciones", "comentarios", "comments"],
};

/** Which column holds each field, from the header row; and whether names come whole. */
function guessColumns(headers: string[]) {
  const names = headers.map((header) => searchable(header).trim());
  const find = (field: keyof typeof HEADERS) => {
    const exact = names.findIndex((name) => HEADERS[field].includes(name));
    if (exact >= 0) return exact;
    const partial = names.findIndex((name) =>
      HEADERS[field].some((word) => word.length > 3 && name.includes(word)),
    );
    return partial >= 0 ? partial : null;
  };
  const fullName = find("fullName");
  const mapping: Mapping = {
    firstName: find("firstName") ?? fullName,
    lastName: find("lastName"),
    phone: find("phone"),
    email: find("email"),
    notes: find("notes"),
  };
  return { mapping, wholeNames: mapping.lastName === null && mapping.firstName !== null };
}

/**
 * "Juan Pablo Ortiz Pérez" → "Juan Pablo" + "Ortiz Pérez". Two words: one each; three: the
 * first name and two last names; more: two first names and the rest.
 */
function splitName(full: string): [string, string] {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [words[0] ?? "", ""];
  const first = words.length >= 4 ? 2 : 1;
  return [words.slice(0, first).join(" "), words.slice(first).join(" ")];
}

/**
 * "Nuevo cliente" with a menu beside it: import customers from Excel or CSV, or export them.
 */
export function CustomersActions({
  onNew,
  customers,
}: {
  onNew: () => void;
  customers: CustomerSummary[];
}) {
  const { t, i18n } = useTranslation();
  const { business } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(open, wrapper, 240, "right");
  useClickOutside(open, [wrapper], () => setOpen(false));

  /** The same columns the import reads first, so an export can be edited and imported back. */
  const sheet = (): Cell[][] => {
    const day = (iso: string | null) =>
      iso ? instantToZoned(Date.parse(iso), business.timezone).date : null;
    return [
      [
        t("customers.import.fields.firstName"),
        t("customers.import.fields.lastName"),
        t("customers.import.fields.phone"),
        t("customers.import.fields.email"),
        t("customers.import.fields.notes"),
        t("booking.birthDate"),
        t("booking.document"),
        t("booking.gender"),
        t("customers.colVisits"),
        t("customers.colLastVisit"),
        t("customers.colNextVisit"),
        t("customers.import.since"),
      ],
      ...customers.map((customer): Cell[] => [
        customer.firstName,
        customer.lastName,
        customer.phone ? formatPhone(customer.phone) : null,
        customer.email,
        customer.notes,
        customer.birthDate,
        customer.document,
        customer.gender ? t(`booking.genders.${customer.gender}`) : null,
        customer.visits,
        day(customer.lastVisit),
        day(customer.nextVisit),
        day(customer.createdAt),
      ]),
    ];
  };
  const fileName = `${t("customers.import.exportFile")}-${business.slug}`;
  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100";

  return (
    <>
      <div ref={wrapper} className="relative inline-flex">
        <Button data-tour="customers-new" onClick={onNew} className="rounded-r-none">
          <Plus className="size-4" aria-hidden />
          {t("customers.new")}
        </Button>
        <Button
          aria-label={t("customers.import.more")}
          title={t("customers.import.more")}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="w-9 rounded-l-none border-l border-on-brand/20 px-0"
        >
          <ChevronDown className="size-4" aria-hidden />
        </Button>
        {open && (
          <div
            role="menu"
            style={placement}
            className="absolute top-full right-0 z-30 mt-1 w-60 rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200"
          >
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                setImporting(true);
              }}
            >
              <Upload className="size-4 text-zinc-400" aria-hidden />
              {t("customers.import.title")}
            </button>
            <div className="my-1 border-t border-zinc-100" />
            <button
              type="button"
              role="menuitem"
              className={cn(item, "disabled:cursor-not-allowed disabled:opacity-50")}
              disabled={customers.length === 0}
              onClick={() => {
                setOpen(false);
                setExporting(true);
              }}
            >
              <Download className="size-4 text-zinc-400" aria-hidden />
              {t("customers.import.export")}
            </button>
          </div>
        )}
      </div>
      {importing && (
        <ImportCustomers onClose={() => setImporting(false)} language={i18n.language} />
      )}
      <ExportCustomers
        open={exporting}
        count={customers.length}
        onClose={() => setExporting(false)}
        onExport={(format) => {
          if (format === "xlsx") downloadXlsx(`${fileName}.xlsx`, t("customers.title"), sheet());
          else downloadCsv(`${fileName}.csv`, sheet());
          setExporting(false);
        }}
      />
    </>
  );
}

const EXPORT_FORMATS = [
  { value: "xlsx", icon: FileSpreadsheet },
  { value: "csv", icon: FileText },
] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number]["value"];

/** "Exportar clientes": pick Excel or CSV, then download. */
function ExportCustomers({
  open,
  count,
  onClose,
  onExport,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("customers.import.export")}
      description={t("customers.import.exportHint", { count })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onExport(format)}>
            <Download className="size-4" aria-hidden />
            {t("customers.import.exportButton")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPORT_FORMATS.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
              className={cn(
                "flex gap-3 rounded-xl border p-3 text-left transition-colors",
                format === value
                  ? "border-brand-500 bg-brand-50/50"
                  : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  format === value ? "text-brand-600" : "text-zinc-400",
                )}
                aria-hidden
              />
              <span>
                <span className="block text-sm font-medium text-zinc-900">
                  {t(`customers.import.exportFormats.${value}.label`)}
                </span>
                <span className="mt-0.5 block text-[13px] text-zinc-500">
                  {t(`customers.import.exportFormats.${value}.hint`)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-[13px] text-zinc-500">{t("customers.import.exportColumns")}</p>
      </div>
    </Modal>
  );
}

type Step = "file" | "columns" | "summary";

/** Customers from a spreadsheet: the file, which column is which, then what will happen. */
function ImportCustomers({ onClose, language }: { onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const { business } = useBusinessContext();
  const importer = useImportCustomers(business.id);
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  /** Each row's number in the file, for the errors. */
  const [lines, setLines] = useState<number[]>([]);
  const [mapping, setMapping] = useState<Mapping>({
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    notes: null,
  });
  const [wholeNames, setWholeNames] = useState(false);
  const [update, setUpdate] = useState(true);
  const summary = importer.data;

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = await readSpreadsheet(file);
      const [header, ...body] = rows;
      if (!header || body.length === 0) {
        toast.error(t("customers.import.empty"));
        return;
      }
      if (body.length > MAX_IMPORT_ROWS) {
        toast.error(
          t("customers.import.tooMany", { max: MAX_IMPORT_ROWS.toLocaleString(language) }),
        );
        return;
      }
      const guess = guessColumns(header.cells);
      setFileName(file.name);
      setHeaders(header.cells);
      setData(body.map((row) => row.cells));
      setLines(body.map((row) => row.line));
      setMapping(guess.mapping);
      setWholeNames(guess.wholeNames);
      setStep("columns");
    } catch {
      toast.error(t("customers.import.unreadable"));
    }
  };

  const rows = data.map((cells) => {
    const at = (field: ImportField) => {
      const index = mapping[field];
      return index === null ? "" : (cells[index] ?? "");
    };
    const [firstName, lastName] =
      wholeNames && mapping.lastName === null
        ? splitName(at("firstName"))
        : [at("firstName"), at("lastName")];
    return { firstName, lastName, phone: at("phone"), email: at("email"), notes: at("notes") };
  });
  const ready = mapping.firstName !== null && (mapping.phone !== null || mapping.email !== null);

  const send = (apply: boolean) =>
    importer.mutate(
      { rows, update, apply },
      {
        onSuccess: (result) => {
          if (!apply) {
            setStep("summary");
            return;
          }
          toast.success(
            t("customers.import.done", {
              created: t("customers.import.createdCount", { count: result.counts.created }),
              updated: t("customers.import.updatedCount", { count: result.counts.updated }),
            }),
          );
          onClose();
        },
        onError: (error) => toast.error(errorMessage(t, error)),
      },
    );

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    load(event.dataTransfer.files[0]);
  };
  const template = () =>
    downloadXlsx(`${t("customers.import.templateFile")}.xlsx`, t("customers.title"), [
      FIELDS.map((field) => t(`customers.import.fields.${field}`)),
      ["Ana", "Pérez", "+57 300 123 4567", "ana@ejemplo.com", t("customers.import.exampleNote")],
    ]);
  /** "B · Teléfono": the spreadsheet's column letter and its header. */
  const column = (index: number) => {
    let letters = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    }
    return `${letters} · ${headers[index] || t("customers.import.noHeader")}`;
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("customers.import.title")}
      description={t(`customers.import.steps.${step}`)}
      footer={
        step === "file" ? (
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        ) : step === "columns" ? (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setStep("file")}>
              {t("common.back")}
            </Button>
            <Button onClick={() => send(false)} disabled={!ready} loading={importer.isPending}>
              {t("customers.import.review")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setStep("columns")}>
              {t("common.back")}
            </Button>
            <Button
              onClick={() => send(true)}
              loading={importer.isPending}
              disabled={!summary || summary.counts.created + summary.counts.updated === 0}
            >
              {t("customers.import.apply", {
                count: (summary?.counts.created ?? 0) + (summary?.counts.updated ?? 0),
              })}
            </Button>
          </>
        )
      }
    >
      {step === "file" && (
        <div className="space-y-3">
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging
                ? "border-brand-400 bg-brand-50/60"
                : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
            )}
          >
            <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
              <FileSpreadsheet className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-medium text-zinc-900">{t("customers.import.drop")}</span>
            <span className="text-[13px] text-zinc-500">
              {t("customers.import.formats", { max: MAX_IMPORT_ROWS.toLocaleString(language) })}
            </span>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,text/csv"
              className="sr-only"
              onChange={(event) => load(event.target.files?.[0])}
            />
          </label>
          <p className="text-[13px] text-zinc-500">
            {t("customers.import.templateHint")}{" "}
            <button
              type="button"
              onClick={template}
              className="font-medium text-brand-700 hover:underline"
            >
              {t("customers.import.template")}
            </button>
          </p>
        </div>
      )}

      {step === "columns" && (
        <div className="space-y-5">
          <p className="flex items-center gap-2 text-sm text-zinc-600">
            <FileSpreadsheet className="size-4 text-zinc-400" aria-hidden />
            <span className="font-medium text-zinc-900">{fileName}</span>·
            {t("customers.import.rows", { count: data.length })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <Field key={field} label={t(`customers.import.fields.${field}`)}>
                {(props) => (
                  <Select
                    {...props}
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [field]: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">{t("customers.import.skipColumn")}</option>
                    {headers.map((_, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positions.
                      <option key={index} value={index}>
                        {column(index)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
            <div className="flex flex-col justify-end gap-2 text-sm">
              {mapping.lastName === null && mapping.firstName !== null && (
                <label className="flex items-center gap-2 text-zinc-700">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={wholeNames}
                    onChange={(event) => setWholeNames(event.target.checked)}
                  />
                  {t("customers.import.wholeNames")}
                </label>
              )}
            </div>
          </div>
          <Field label={t("customers.import.existing")}>
            {(props) => (
              <Select
                {...props}
                value={update ? "update" : "keep"}
                onChange={(event) => setUpdate(event.target.value === "update")}
              >
                <option value="update">{t("customers.import.update")}</option>
                <option value="keep">{t("customers.import.keep")}</option>
              </Select>
            )}
          </Field>
          {!ready && <p className="text-[13px] text-amber-700">{t("customers.import.needed")}</p>}
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-[12px] font-medium tracking-wide text-zinc-500 uppercase">
                <tr>
                  {(["firstName", "lastName", "phone", "email"] as const).map((field) => (
                    <th key={field} className="px-3 py-2">
                      {t(`customers.import.fields.${field}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.slice(0, 5).map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed preview of the file.
                  <tr key={index}>
                    <td className="px-3 py-2 text-zinc-900">{row.firstName || "—"}</td>
                    <td className="px-3 py-2 text-zinc-900">{row.lastName || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600 tabular-nums">{row.phone || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{row.email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-zinc-500">{t("customers.import.matchHint")}</p>
        </div>
      )}

      {step === "summary" && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["created", summary.counts.created],
                [
                  update ? "updated" : "skipped",
                  update ? summary.counts.updated : summary.counts.skipped,
                ],
                ["unchanged", summary.counts.unchanged],
                ["errors", summary.counts.errors],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  key === "errors" && value > 0
                    ? "border-amber-200 bg-amber-50"
                    : "border-zinc-200",
                )}
              >
                <div className="text-[12px] text-zinc-500">
                  {t(`customers.import.counts.${key}`)}
                </div>
                <div className="mt-0.5 text-xl font-semibold text-zinc-900 tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
          {summary.results.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200">
              <ul className="divide-y divide-zinc-100 text-sm">
                {summary.results.slice(0, 200).map((result) => (
                  <li key={result.row} className="flex items-start gap-2 px-3 py-2">
                    <TriangleAlert
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        result.error ? "text-amber-500" : "text-zinc-400",
                      )}
                      aria-hidden
                    />
                    <span className="text-zinc-700">
                      <span className="font-medium text-zinc-900">
                        {t("customers.import.row", { row: lines[result.row] ?? result.row + 2 })}
                      </span>{" "}
                      {[rows[result.row]?.firstName, rows[result.row]?.lastName]
                        .filter(Boolean)
                        .join(" ")}
                      {" — "}
                      {t([
                        `customers.import.problems.${result.error ?? result.warning}`,
                        "customers.import.problems.invalid",
                      ] as unknown as "customers.import.problems.invalid")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[13px] text-zinc-500">
            {summary.counts.errors > 0
              ? t("customers.import.errorsHint")
              : t("customers.import.readyHint")}
          </p>
        </div>
      )}
    </Modal>
  );
}

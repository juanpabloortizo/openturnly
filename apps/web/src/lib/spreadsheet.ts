/** A row with cells, and its number in the file (1 = the first row), to point at it. */
export type SheetRow = { line: number; cells: string[] };

/**
 * Reading spreadsheets people upload, in the browser and without a library: CSV (commas,
 * semicolons or tabs, as Excel saves them in each country) and Excel's .xlsx, whose first
 * sheet comes out as rows of text. Empty rows are left out; the others keep their number.
 */
export async function readSpreadsheet(file: File): Promise<SheetRow[]> {
  return /\.xlsx$/i.test(file.name)
    ? readXlsx(await file.arrayBuffer())
    : parseCsv(await file.text());
}

export function parseCsv(text: string): SheetRow[] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.slice(0, clean.search(/\r?\n/) >>> 0);
  // Whichever separator the header row uses most.
  const delimiter =
    [";", ",", "\t"]
      .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
      .sort((a, b) => b.count - a.count)[0]?.candidate ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows
    .map((cells, index) => ({ line: index + 1, cells }))
    .filter((row) => row.cells.some(Boolean));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a zip archive (an .xlsx is one) whose names `wanted` accepts, as text. */
async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean) {
  const view = new DataView(buffer);
  // The end-of-directory record sits in the last 64 KB, after an optional comment.
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not_a_spreadsheet");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = new Uint8Array(buffer, start, size);
    const bytes = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (bytes) files.set(name, decoder.decode(bytes));
  }
  return files;
}

/** Column "A" → 0, "AB" → 27. */
function columnIndex(letters: string) {
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export async function readXlsx(buffer: ArrayBuffer): Promise<SheetRow[]> {
  const files = await unzip(
    buffer,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      name.startsWith("xl/worksheets/"),
  );
  const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
  const texts = (element: Element) =>
    [...element.getElementsByTagName("t")].map((node) => node.textContent ?? "").join("");

  // The first sheet in the workbook's own order.
  let path = "xl/worksheets/sheet1.xml";
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const first = xml(workbook).getElementsByTagName("sheet")[0];
    const id = first?.getAttribute("r:id");
    const target = [...xml(rels).getElementsByTagName("Relationship")]
      .find((rel) => rel.getAttribute("Id") === id)
      ?.getAttribute("Target");
    if (target) path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet =
    files.get(path) ??
    [...files.entries()].find(([name]) => /^xl\/worksheets\/sheet\d*\.xml$/.test(name))?.[1];
  if (!sheet) throw new Error("not_a_spreadsheet");
  const shared = files.get("xl/sharedStrings.xml");
  const strings = shared ? [...xml(shared).getElementsByTagName("si")].map(texts) : [];

  const rows: SheetRow[] = [];
  for (const row of xml(sheet).getElementsByTagName("row")) {
    const cells: string[] = [];
    for (const cell of row.getElementsByTagName("c")) {
      const letters = (cell.getAttribute("r") ?? "").replace(/\d+/g, "");
      const index = letters ? columnIndex(letters) : cells.length;
      const type = cell.getAttribute("t");
      const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      let text =
        type === "s" ? (strings[Number(value)] ?? "") : type === "inlineStr" ? texts(cell) : value;
      // Long numbers (phones) saved as numbers can come in scientific notation.
      if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) text = Number(text).toFixed(0);
      cells[index] = text.trim();
    }
    // Rows with nothing in them are often missing from the file: "r" keeps the count right.
    rows.push({
      line: Number(row.getAttribute("r")) || rows.length + 1,
      cells: Array.from(cells, (cell) => cell ?? ""),
    });
  }
  return rows.filter((row) => row.cells.some(Boolean));
}

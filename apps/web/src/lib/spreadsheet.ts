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

type XmlNode = { name: string; attributes: Record<string, string>; children: (XmlNode | string)[] };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** "&lt;b&gt; &#233;" → "<b> é". Unknown or broken references stay as written. */
function decodeXml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (reference, code: string) => {
    if (!code.startsWith("#")) return ENTITIES[code] ?? reference;
    const point =
      code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : reference;
  });
}

/**
 * A small reader for the XML inside a spreadsheet: elements, their attributes and text,
 * and nothing that could run or load. Prefixes are dropped from element names ("x:row" is
 * a row), as some programs write them.
 */
function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: "", attributes: {}, children: [] };
  const open: XmlNode[] = [root];
  const tokens =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (const token of text.matchAll(tokens)) {
    const current = open[open.length - 1] as XmlNode;
    if (token.index > last) current.children.push(decodeXml(text.slice(last, token.index)));
    last = token.index + token[0].length;
    const [, cdata, closing, opening, attributes = "", selfClosing] = token;
    if (cdata !== undefined) {
      current.children.push(cdata);
    } else if (closing) {
      if (open.length > 1) open.pop();
    } else if (opening) {
      const node: XmlNode = { name: opening.replace(/^.*:/, ""), attributes: {}, children: [] };
      for (const [, name = "", double, single] of attributes.matchAll(
        /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      )) {
        node.attributes[name] = decodeXml(double ?? single ?? "");
      }
      current.children.push(node);
      if (!selfClosing) open.push(node);
    }
    // Comments, declarations and processing instructions are left out.
  }
  return root;
}

/** Every element called `name` inside `node`, in the order of the file. */
function elementsOf(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) =>
    typeof child === "string"
      ? []
      : [...(child.name === name ? [child] : []), ...elementsOf(child, name)],
  );
}

/** All the text inside an element. */
function textOf(node: XmlNode): string {
  return node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
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
  const texts = (element: XmlNode) => elementsOf(element, "t").map(textOf).join("");

  // The first sheet in the workbook's own order.
  let path = "xl/worksheets/sheet1.xml";
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const first = elementsOf(parseXml(workbook), "sheet")[0];
    const id = first?.attributes["r:id"];
    const target = elementsOf(parseXml(rels), "Relationship").find(
      (rel) => rel.attributes.Id === id,
    )?.attributes.Target;
    if (target) path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet =
    files.get(path) ??
    [...files.entries()].find(([name]) => /^xl\/worksheets\/sheet\d*\.xml$/.test(name))?.[1];
  if (!sheet) throw new Error("not_a_spreadsheet");
  const shared = files.get("xl/sharedStrings.xml");
  const strings = shared ? elementsOf(parseXml(shared), "si").map(texts) : [];

  const rows: SheetRow[] = [];
  for (const row of elementsOf(parseXml(sheet), "row")) {
    const cells: string[] = [];
    for (const cell of elementsOf(row, "c")) {
      const letters = (cell.attributes.r ?? "").replace(/\d+/g, "");
      const index = letters ? columnIndex(letters) : cells.length;
      const type = cell.attributes.t;
      const valueNode = elementsOf(cell, "v")[0];
      const value = valueNode ? textOf(valueNode) : "";
      let text =
        type === "s" ? (strings[Number(value)] ?? "") : type === "inlineStr" ? texts(cell) : value;
      // Long numbers (phones) saved as numbers can come in scientific notation.
      if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) text = Number(text).toFixed(0);
      cells[index] = text.trim();
    }
    // Rows with nothing in them are often missing from the file: "r" keeps the count right.
    rows.push({
      line: Number(row.attributes.r) || rows.length + 1,
      cells: Array.from(cells, (cell) => cell ?? ""),
    });
  }
  return rows.filter((row) => row.cells.some(Boolean));
}

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_DATA_ROWS = 500;
export const CSV_MAX_COLUMNS = 32;
export const CSV_MAX_CELL_CHARACTERS = 10_000;

export const TEMPLATE_COLUMNS = [
  "title",
  "writer_name",
  "writer_email",
  "logline",
  "genre",
  "page_count",
  "script_url",
  "format",
  "notes",
] as const;

export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export interface ParsedRow {
  title?: string;
  writer_name?: string;
  writer_email?: string;
  logline?: string;
  genre?: string;
  page_count?: number;
  script_url?: string;
  format?: string;
  notes?: string;
}

const TEMPLATE_SAMPLE = [
  "Sample Title",
  "Jane Writer",
  "jane@example.com",
  "A short one-line pitch.",
  "Drama",
  "95",
  "https://example.com/script.pdf",
  "pdf",
  "Optional notes",
] as const;

const SUPPORTED_COLUMNS = new Set<string>(TEMPLATE_COLUMNS);

function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function downloadTemplate() {
  const csv = [TEMPLATE_COLUMNS, TEMPLATE_SAMPLE]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv, "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "judging-import-template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;

  const append = (character: string) => {
    if (field.length >= CSV_MAX_CELL_CHARACTERS) {
      throw new Error(`CSV cells cannot exceed ${CSV_MAX_CELL_CHARACTERS} characters.`);
    }
    field += character;
  };

  const finishField = () => {
    if (row.length >= CSV_MAX_COLUMNS) {
      throw new Error(`CSV rows cannot contain more than ${CSV_MAX_COLUMNS} columns.`);
    }
    row.push(field);
    field = "";
    closedQuote = false;
  };

  const finishRow = () => {
    finishField();
    if (row.some((cell) => cell.trim() !== "")) {
      if (records.length >= CSV_MAX_DATA_ROWS + 1) {
        throw new Error(`CSV can contain at most ${CSV_MAX_DATA_ROWS} data rows.`);
      }
      records.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else if (character === "\r" && text[index + 1] === "\n") {
        append("\n");
        index += 1;
      } else {
        append(character);
      }
      continue;
    }

    if (closedQuote) {
      if (character === " " || character === "\t") continue;
      if (character === ",") {
        finishField();
        continue;
      }
      if (character === "\r" || character === "\n") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        continue;
      }
      throw new Error("CSV contains unexpected text after a closing quote.");
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error("CSV quotes must begin at the start of a field.");
      }
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      append(character);
    }
  }

  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");
  if (closedQuote || field.length > 0 || row.length > 0) finishRow();

  return records;
}

export async function parseSpreadsheet(file: File): Promise<ParsedRow[]> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("Only .csv files are supported.");
  }
  if (file.size === 0) throw new Error("CSV file is empty.");
  if (file.size > CSV_MAX_BYTES) throw new Error("CSV file must be 1 MiB or smaller.");

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > CSV_MAX_BYTES) throw new Error("CSV file must be 1 MiB or smaller.");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("CSV file must contain valid UTF-8 text.");
  }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (text.includes("\u0000")) throw new Error("CSV file must contain text, not binary data.");

  const records = parseCsvRecords(text);
  if (records.length === 0) throw new Error("CSV file is empty.");

  const [headerRow, ...dataRows] = records;
  const headers = headerRow.map(normalizeHeader);
  const recognizedHeaders = headers.filter((header) => SUPPORTED_COLUMNS.has(header));
  if (recognizedHeaders.length === 0) {
    throw new Error(`CSV header must include at least one supported column: ${TEMPLATE_COLUMNS.join(", ")}.`);
  }
  if (new Set(recognizedHeaders).size !== recognizedHeaders.length) {
    throw new Error("CSV header contains duplicate supported columns.");
  }

  return dataRows.map((values, rowIndex) => {
    if (values.length > headers.length && values.slice(headers.length).some((value) => value.trim() !== "")) {
      throw new Error(`CSV data row ${rowIndex + 1} contains more values than the header.`);
    }

    const out: ParsedRow = {};
    headers.forEach((key, columnIndex) => {
      if (!SUPPORTED_COLUMNS.has(key)) return;
      const value = values[columnIndex]?.trim();
      if (!value) return;

      if (key === "page_count") {
        const pageCount = Number(value);
        out.page_count = Number.isFinite(pageCount) ? Math.round(pageCount) : undefined;
      } else {
        (out as Record<string, string | number | undefined>)[key] = value;
      }
    });
    return out;
  });
}

export interface RowValidation {
  ok: boolean;
  errors: string[];
}

export function validateRow(row: ParsedRow): RowValidation {
  const errors: string[] = [];
  if (!row.title) errors.push("title required");
  if (!row.writer_name) errors.push("writer_name required");
  if (!row.writer_email) errors.push("writer_email required");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.writer_email)) errors.push("invalid email");
  if (!row.page_count || row.page_count < 1 || row.page_count > 500) errors.push("page_count 1-500");
  if (!row.script_url) errors.push("script_url required");
  else if (!/^https:\/\//i.test(row.script_url)) errors.push("script_url must be https");
  return { ok: errors.length === 0, errors };
}

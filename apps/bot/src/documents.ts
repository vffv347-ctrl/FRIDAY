import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import PDFDocument from "pdfkit";

// Работа с документами: чтение присланных и генерация новых.

// ════════════════════════════════════════════════════════════════
//  Чтение присланных документов
// ════════════════════════════════════════════════════════════════

const MAX_TEXT = 80_000; // ограничение, чтобы не раздувать контекст

export type ReadResult =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "unsupported" };

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT), truncated: true };
}

export async function readDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string | undefined,
): Promise<ReadResult> {
  const name = fileName.toLowerCase();

  if (name.endsWith(".pdf") || mimeType === "application/pdf") {
    return { kind: "pdf", base64: buffer.toString("base64") };
  }

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    const { text, truncated } = cap(value.trim());
    return { kind: "text", text, truncated };
  }

  if (name.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    // Приведение типа: @types/node и exceljs трактуют Buffer чуть по-разному.
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      lines.push(`# Лист: ${sheet.name}`);
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.text ?? "");
        });
        lines.push(cells.join(" | "));
      });
    });
    const { text, truncated } = cap(lines.join("\n").trim());
    return { kind: "text", text, truncated };
  }

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    (mimeType?.startsWith("text/") ?? false)
  ) {
    const { text, truncated } = cap(buffer.toString("utf-8").trim());
    return { kind: "text", text, truncated };
  }

  return { kind: "unsupported" };
}

// ════════════════════════════════════════════════════════════════
//  Генерация документов
// ════════════════════════════════════════════════════════════════

// Шрифт с кириллицей для PDF (assets/font.ttf — DejaVu Sans).
const FONT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "font.ttf",
);

export type DocSpec = {
  format: "pdf" | "docx" | "xlsx";
  filename: string;
  title?: string;
  body?: string;
  table?: unknown[][];
};

function withExt(name: string, ext: string): string {
  const clean = name.trim() || "Документ";
  return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
}

async function createDocx(title: string, body: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (title) {
    children.push(
      new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    );
  }
  for (const line of body.split("\n")) {
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function createXlsx(
  title: string,
  table: unknown[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const safeName =
    title.replace(/[*?:\\/[\]]/g, " ").slice(0, 31).trim() || "Лист1";
  const sheet = workbook.addWorksheet(safeName);

  for (const row of table) {
    sheet.addRow(row);
  }
  if (table.length > 0) {
    sheet.getRow(1).font = { bold: true };
  }
  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}

function createPdf(title: string, body: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(FONT_PATH);
    if (title) {
      doc.fontSize(20).text(title);
      doc.moveDown();
    }
    doc.fontSize(12);
    for (const line of body.split("\n")) {
      doc.text(line || " ");
    }
    doc.end();
  });
}

export async function generateDocument(
  spec: DocSpec,
): Promise<{ buffer: Buffer; filename: string }> {
  const title = spec.title?.trim() ?? "";

  if (spec.format === "xlsx") {
    const buffer = await createXlsx(title, spec.table ?? []);
    return { buffer, filename: withExt(spec.filename, "xlsx") };
  }

  const body = spec.body?.trim() ?? "";
  if (spec.format === "docx") {
    const buffer = await createDocx(title, body);
    return { buffer, filename: withExt(spec.filename, "docx") };
  }

  const buffer = await createPdf(title, body);
  return { buffer, filename: withExt(spec.filename, "pdf") };
}

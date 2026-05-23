import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

// Генерация счёта на оплату — PDF и DOCX в одном вызове.
// Шаблон повторяет привычный казахстанский формат «Счёт на оплату»:
// верхнее уведомление, блок реквизитов банка, заголовок, поставщик/покупатель,
// таблица услуг, итог, сумма прописью, строка подписи.

const FONT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "font.ttf",
);

const DEFAULT_NOTICE =
  "Внимание! Оплата данного счета означает согласие с условиями поставки товара. " +
  "Уведомление об оплате обязательно, в противном случае не гарантируется наличие товара на складе. " +
  "Товар отпускается по факту прихода денег на р/с Поставщика, самовывозом, при наличии доверенности " +
  "и документов удостоверяющих личность.";

export type InvoiceItem = {
  code?: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
};

export type InvoiceSpec = {
  number: string;
  date?: string;
  currency?: string;
  notice?: string;
  supplier: { name: string; bin: string; address?: string };
  buyer: { name: string; bin: string };
  contract?: string;
  bank: {
    beneficiaryName: string;
    beneficiaryBin?: string;
    iik: string;
    kbe?: string;
    bankName: string;
    bik?: string;
    knp?: string;
  };
  items: InvoiceItem[];
  amountInWords: string;
  signer?: string;
};

function fmtNum(n: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(n);
}

function todayRu(): string {
  const formatted = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${formatted} г.`;
}

function totalsOf(items: InvoiceItem[]): { perRow: number[]; total: number } {
  const perRow = items.map((it) => (it.quantity ?? 0) * (it.price ?? 0));
  const total = perRow.reduce((a, b) => a + b, 0);
  return { perRow, total };
}

// ── PDF ──────────────────────────────────────────────────────────

function createPdf(spec: InvoiceSpec): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(FONT_PATH);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const pageW = right - left;
    const date = spec.date ?? todayRu();
    const currency = spec.currency ?? "KZT";
    const signer = spec.signer ?? "/Директор/";

    // Верхнее уведомление — мелкое, по центру.
    doc.fontSize(8);
    const noticeText = spec.notice ?? DEFAULT_NOTICE;
    const noticeW = pageW * 0.7;
    const noticeX = left + (pageW - noticeW) / 2;
    doc.text(noticeText, noticeX, doc.page.margins.top, {
      width: noticeW,
      align: "center",
    });
    let y = doc.y + 10;

    // «Образец платежного поручения»
    doc.fontSize(10);
    doc.text("Образец платежного поручения", left, y, { width: pageW });
    y = doc.y + 4;

    // Блок реквизитов банка — 2 строки × 3 ячейки, в каждой ячейке метка + значение.
    const cw1 = pageW * 0.58;
    const cw2 = pageW * 0.24;
    const cw3 = pageW - cw1 - cw2;

    const beneCell =
      `Бенефициар:\n${spec.bank.beneficiaryName}` +
      (spec.bank.beneficiaryBin ? `\nИИН: ${spec.bank.beneficiaryBin}` : "");

    y = drawThreeColRow(doc, left, y, [cw1, cw2, cw3], [
      beneCell,
      `ИИК\n${spec.bank.iik}`,
      `Кбе\n${spec.bank.kbe ?? ""}`,
    ]);
    y = drawThreeColRow(doc, left, y, [cw1, cw2, cw3], [
      `Банк бенефициара:\n${spec.bank.bankName}`,
      `БИК\n${spec.bank.bik ?? ""}`,
      `Код назначения платежа\n${spec.bank.knp ?? ""}`,
    ]);

    y += 16;

    // Заголовок
    doc.fontSize(16);
    doc.text(`Счёт на оплату № ${spec.number} от ${date}`, left, y, {
      width: pageW,
    });
    y = doc.y + 4;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).stroke();
    y += 8;

    // Поставщик / Покупатель / Договор
    doc.fontSize(10);
    const labelW = 76;
    const valueW = pageW - labelW;
    const supplierText =
      `БИН / ИИН ${spec.supplier.bin}, ${spec.supplier.name}` +
      (spec.supplier.address ? `, ${spec.supplier.address}` : "");
    const buyerText = `БИН / ИИН ${spec.buyer.bin}, ${spec.buyer.name}`;

    y = drawLabelLine(doc, left, y, labelW, valueW, "Поставщик:", supplierText);
    y = drawLabelLine(doc, left, y, labelW, valueW, "Покупатель:", buyerText);
    if (spec.contract) {
      y = drawLabelLine(doc, left, y, labelW, valueW, "Договор:", spec.contract);
    }
    y += 10;

    // Таблица позиций
    const itemsNameW = pageW - (25 + 55 + 50 + 55 + 60 + 65);
    const colW = [25, 55, itemsNameW, 50, 55, 60, 65];
    y = drawTableRow(
      doc,
      left,
      y,
      colW,
      ["№", "Код", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"],
    );

    const { perRow, total } = totalsOf(spec.items);
    spec.items.forEach((it, i) => {
      y = drawTableRow(doc, left, y, colW, [
        String(i + 1),
        it.code ?? "",
        it.name,
        fmtQty(it.quantity),
        it.unit,
        fmtNum(it.price),
        fmtNum(perRow[i]),
      ]);
    });

    y += 10;

    // Итого справа
    doc.fontSize(11);
    doc.text(`Итого: ${fmtNum(total)}`, left, y, {
      width: pageW,
      align: "right",
    });
    y = doc.y + 10;

    // Сумма строкой и прописью
    doc.fontSize(10);
    doc.text(
      `Всего наименований ${spec.items.length}, на сумму ${fmtNum(total)} ${currency}`,
      left,
      y,
      { width: pageW },
    );
    y = doc.y + 4;
    doc.fontSize(11);
    doc.text(`Всего к оплате: ${spec.amountInWords}`, left, y, {
      width: pageW,
    });
    y = doc.y + 40;

    // Подпись
    doc.fontSize(10);
    doc.text("Исполнитель", left, y);
    const sigStart = left + 70;
    const sigEnd = right - 80;
    doc
      .moveTo(sigStart, y + 12)
      .lineTo(sigEnd, y + 12)
      .lineWidth(0.5)
      .stroke();
    doc.text(signer, sigEnd + 4, y, { width: 80 });

    doc.end();
  });
}

function drawThreeColRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  widths: [number, number, number],
  cells: [string, string, string],
): number {
  doc.fontSize(9);
  const heights = cells.map((text, i) =>
    doc.heightOfString(text, { width: widths[i] - 8 }),
  );
  const h = Math.max(...heights) + 8;
  let cx = x;
  for (let i = 0; i < 3; i++) {
    doc.rect(cx, y, widths[i], h).stroke();
    doc.text(cells[i], cx + 4, y + 4, { width: widths[i] - 8 });
    cx += widths[i];
  }
  return y + h;
}

function drawLabelLine(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  labelW: number,
  valueW: number,
  label: string,
  value: string,
): number {
  doc.fontSize(10);
  const lh = doc.heightOfString(label, { width: labelW });
  const vh = doc.heightOfString(value, { width: valueW });
  const h = Math.max(lh, vh) + 4;
  doc.text(label, x, y, { width: labelW });
  doc.text(value, x + labelW, y, { width: valueW });
  return y + h;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  widths: number[],
  cells: string[],
): number {
  doc.fontSize(9);
  const heights = cells.map((text, i) =>
    doc.heightOfString(text || " ", { width: widths[i] - 6 }),
  );
  const h = Math.max(...heights) + 8;
  let cx = x;
  for (let i = 0; i < cells.length; i++) {
    doc.rect(cx, y, widths[i], h).stroke();
    const align = i === 0 || i >= 3 ? "right" : "left";
    doc.text(cells[i] ?? "", cx + 3, y + 4, {
      width: widths[i] - 6,
      align: align as "left" | "right",
    });
    cx += widths[i];
  }
  return y + h;
}

// ── DOCX ─────────────────────────────────────────────────────────

async function createDocx(spec: InvoiceSpec): Promise<Buffer> {
  const date = spec.date ?? todayRu();
  const currency = spec.currency ?? "KZT";
  const signer = spec.signer ?? "/Директор/";
  const { perRow, total } = totalsOf(spec.items);

  const thin = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = {
    top: thin,
    bottom: thin,
    left: thin,
    right: thin,
    insideHorizontal: thin,
    insideVertical: thin,
  };

  const beneLines = [
    "Бенефициар:",
    spec.bank.beneficiaryName,
    spec.bank.beneficiaryBin ? `ИИН: ${spec.bank.beneficiaryBin}` : "",
  ].filter(Boolean);

  const bankTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 58, type: WidthType.PERCENTAGE },
            children: beneLines.map((line) => new Paragraph(line)),
          }),
          new TableCell({
            width: { size: 24, type: WidthType.PERCENTAGE },
            children: [new Paragraph("ИИК"), new Paragraph(spec.bank.iik)],
          }),
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph("Кбе"),
              new Paragraph(spec.bank.kbe ?? ""),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 58, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph("Банк бенефициара:"),
              new Paragraph(spec.bank.bankName),
            ],
          }),
          new TableCell({
            width: { size: 24, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph("БИК"),
              new Paragraph(spec.bank.bik ?? ""),
            ],
          }),
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph("Код назначения платежа"),
              new Paragraph(spec.bank.knp ?? ""),
            ],
          }),
        ],
      }),
    ],
  });

  const itemHeader = new TableRow({
    children: ["№", "Код", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"].map(
      (label) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: label, bold: true })],
            }),
          ],
        }),
    ),
  });

  const itemRows = spec.items.map(
    (it, i) =>
      new TableRow({
        children: [
          String(i + 1),
          it.code ?? "",
          it.name,
          fmtQty(it.quantity),
          it.unit,
          fmtNum(it.price),
          fmtNum(perRow[i]),
        ].map((v) => new TableCell({ children: [new Paragraph(v)] })),
      }),
  );

  const itemTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [itemHeader, ...itemRows],
  });

  const supplierLine =
    `БИН / ИИН ${spec.supplier.bin}, ${spec.supplier.name}` +
    (spec.supplier.address ? `, ${spec.supplier.address}` : "");

  const children: Paragraph[] | (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: spec.notice ?? DEFAULT_NOTICE, size: 16 }),
      ],
    }),
    new Paragraph(""),
    new Paragraph({
      children: [
        new TextRun({ text: "Образец платежного поручения", bold: true }),
      ],
    }),
    bankTable,
    new Paragraph(""),
    new Paragraph({
      children: [
        new TextRun({
          text: `Счёт на оплату № ${spec.number} от ${date}`,
          bold: true,
          size: 32,
        }),
      ],
    }),
    new Paragraph(""),
    new Paragraph({
      children: [
        new TextRun({ text: "Поставщик: ", bold: true }),
        new TextRun(supplierLine),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Покупатель: ", bold: true }),
        new TextRun(`БИН / ИИН ${spec.buyer.bin}, ${spec.buyer.name}`),
      ],
    }),
    ...(spec.contract
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Договор: ", bold: true }),
              new TextRun(spec.contract),
            ],
          }),
        ]
      : []),
    new Paragraph(""),
    itemTable,
    new Paragraph(""),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: `Итого: ${fmtNum(total)}`, bold: true }),
      ],
    }),
    new Paragraph(""),
    new Paragraph(
      `Всего наименований ${spec.items.length}, на сумму ${fmtNum(total)} ${currency}`,
    ),
    new Paragraph({
      children: [
        new TextRun({ text: "Всего к оплате: ", bold: true }),
        new TextRun(spec.amountInWords),
      ],
    }),
    new Paragraph(""),
    new Paragraph(""),
    new Paragraph(`Исполнитель _________________________  ${signer}`),
  ];

  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

// ── Публичный вход ──────────────────────────────────────────────

export async function generateInvoice(spec: InvoiceSpec): Promise<{
  pdf: Buffer;
  docx: Buffer;
  filename: string;
}> {
  const safeNum = spec.number.replace(/[^a-zA-Z0-9_\-А-Яа-я№]+/g, "_");
  const filename = `Счёт_${safeNum}`;
  const [pdf, docx] = await Promise.all([createPdf(spec), createDocx(spec)]);
  return { pdf, docx, filename };
}

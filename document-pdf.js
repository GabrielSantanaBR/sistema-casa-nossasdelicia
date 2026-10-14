import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const regularFont =
  require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff");
const boldFont =
  require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff");
const money = (n) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (d) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "-";
const clean = (s) =>
  String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
export function documentPDF(row) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      bufferPages: true,
      info: {
        Title: `${row.code} - Comprovante de ${row.kind === "sale" ? "venda" : "compra"}`,
        Author: row.issuer_snapshot.name,
      },
    });
    const chunks = [];
    doc.registerFont("Inter", regularFont);
    doc.registerFont("InterBold", boldFont);
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = 507,
      left = 44,
      right = 551;
    const text = (
      s,
      x,
      y,
      w = width,
      size = 10,
      font = "Helvetica",
      align = "left",
    ) =>
      doc
        .font(font === "Helvetica-Bold" ? "InterBold" : "Inter")
        .fontSize(size)
        .fillColor("#252a2d")
        .text(clean(s), x, y, { width: w, align, lineGap: 3 });
    const height = (s, w, size = 10) =>
      doc
        .font("Inter")
        .fontSize(size)
        .heightOfString(clean(s), { width: w, lineGap: 3 });
    const line = (y) =>
      doc
        .strokeColor("#ddd7cf")
        .lineWidth(0.6)
        .moveTo(left, y)
        .lineTo(right, y)
        .stroke();
    const heading = () => {
      const titleBottom =
        44 +
        doc
          .font("InterBold")
          .fontSize(22)
          .heightOfString(clean(row.issuer_snapshot.name), {
            width: 345,
            lineGap: 3,
          });
      const labelY = Math.max(82, titleBottom + 12);
      text(row.issuer_snapshot.name, left, 44, 345, 22, "Helvetica-Bold");
      text(row.code, 400, 47, 151, 12, "Helvetica-Bold", "right");
      text(
        `COMPROVANTE DE ${row.kind === "sale" ? "VENDA" : "COMPRA"} - NÃO FISCAL`,
        left,
        labelY,
        width,
        10,
        "Helvetica-Bold",
      );
      if (row.deleted_at)
        text(
          "CANCELADO - registro na lixeira",
          left,
          labelY + 20,
          width,
          11,
          "Helvetica-Bold",
        );
      const bottom = labelY + (row.deleted_at ? 44 : 26);
      line(bottom);
      return bottom + 18;
    };
    let y = heading();
    const issuer = [
      row.issuer_snapshot.document &&
        `CPF/CNPJ: ${row.issuer_snapshot.document}`,
      row.issuer_snapshot.address,
      row.issuer_snapshot.phone,
    ]
      .filter(Boolean)
      .join("\n");
    if (issuer) {
      text(issuer, left, y);
      y += height(issuer, width) + 16;
    }
    text(
      row.kind === "sale"
        ? "CAFETERIA / CLIENTE"
        : "FORNECEDOR / LOCAL DA COMPRA",
      left,
      y,
      width,
      9,
      "Helvetica-Bold",
    );
    y += 20;
    const party = [
      row.party_snapshot.name,
      row.party_snapshot.document && `CPF/CNPJ: ${row.party_snapshot.document}`,
      row.party_snapshot.address,
    ]
      .filter(Boolean)
      .join("\n");
    text(party, left, y);
    y += height(party, width) + 20;
    text(
      `Data: ${date(row.issued_date)}     Vencimento: ${date(row.due_date)}`,
      left,
      y,
    );
    y += 22;
    if (row.reference) {
      const ref = `Referência: ${row.reference}`;
      text(ref, left, y);
      y += height(ref, width) + 12;
    }
    const tableHeader = () => {
      doc.rect(left, y, width, 27).fill("#f3f0ea");
      text("Item", left + 8, y + 8, 219, 9, "Helvetica-Bold");
      text("Qtd. / un.", 275, y + 8, 75, 9, "Helvetica-Bold", "right");
      text("Unitário", 357, y + 8, 85, 9, "Helvetica-Bold", "right");
      text("Total", 449, y + 8, 94, 9, "Helvetica-Bold", "right");
      y += 35;
    };
    tableHeader();
    for (const item of row.items) {
      const h = Math.max(34, height(item.name, 215) + 14);
      if (y + h > 715) {
        doc.addPage();
        y = heading();
        tableHeader();
      }
      text(item.name, left + 8, y + 4, 215, 10);
      text(
        `${Number(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${item.unit}`,
        270,
        y + 4,
        80,
        9,
        "Helvetica",
        "right",
      );
      text(money(item.unit_price), 357, y + 4, 85, 9, "Helvetica", "right");
      text(money(item.total), 449, y + 4, 94, 9, "Helvetica", "right");
      y += h;
      line(y);
      y += 5;
    }
    if (y + 125 > 730) {
      doc.addPage();
      y = heading();
    }
    y += 12;
    text("TOTAL", left, y, 230, 11, "Helvetica-Bold");
    text(money(row.amount), 300, y, 251, 20, "Helvetica-Bold", "right");
    y += 39;
    text(
      row.deleted_at
        ? "Cancelado"
        : row.paid_date
          ? `${row.kind === "sale" ? "Recebido" : "Pago"} em ${date(row.paid_date)}`
          : `${row.kind === "sale" ? "A receber" : "A pagar"} - pagamento pendente`,
      left,
      y,
      width,
      10,
      "Helvetica-Bold",
    );
    y += 28;
    if (row.notes) {
      text("Observações", left, y, width, 10, "Helvetica-Bold");
      y += 20;
      const lines = [];
      let lineText = "";
      doc.font("Inter").fontSize(10);
      for (const word of clean(row.notes).split(/\s+/)) {
        if (lineText && doc.widthOfString(`${lineText} ${word}`) > width) {
          lines.push(lineText);
          lineText = "";
        }
        for (const character of word) {
          if (doc.widthOfString(lineText + character) > width) {
            lines.push(lineText);
            lineText = "";
          }
          lineText += character;
        }
        lineText += " ";
      }
      if (lineText) lines.push(lineText.trim());
      for (const noteLine of lines) {
        if (y + 17 > 730) {
          doc.addPage();
          y = heading();
        }
        text(noteLine.trim(), left, y);
        y += 17;
      }
    }
    const { count } = doc.bufferedPageRange();
    for (let p = 0; p < count; p++) {
      doc.switchToPage(p);
      line(766);
      text(
        "Documento de controle comercial. Não substitui nota fiscal.",
        left,
        778,
        420,
        8,
      );
      text(`${p + 1} / ${count}`, 480, 778, 71, 8, "Helvetica", "right");
    }
    doc.end();
  });
}

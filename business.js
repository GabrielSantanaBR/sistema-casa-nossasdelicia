import {
  error,
  safeText,
  validDate,
  todayBR,
  validId,
  moneyValue,
  csvCell,
} from "./finance.js";
import { documentPDF } from "./document-pdf.js";

export const units = ["un", "kg", "g", "l", "ml", "pacote", "caixa"];
export function lineValue(quantity, unitPrice) {
  if (
    !["string", "number"].includes(typeof quantity) ||
    !/^\d{1,9}(\.\d{1,3})?$/.test(String(quantity))
  )
    throw error("Quantidade inválida. Use até três casas decimais.");
  const [whole, fraction = ""] = String(quantity).split(".");
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (scaled <= 0n) throw error("A quantidade deve ser maior que zero");
  const price = moneyValue(unitPrice, { positive: true });
  const cents = BigInt(price.replace(".", ""));
  const amount = (scaled * cents + 500n) / 1000n;
  if (amount < 1n || amount > 99999999999999n)
    throw error("Total do item fora do intervalo permitido");
  return {
    quantity: `${whole}.${fraction.padEnd(3, "0")}`,
    unit_price: price,
    total: centsText(amount),
  };
}
const centsText = (n) => `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
export const documentNumber = (row) =>
  `ND-${row.kind === "sale" ? "V" : "C"}${String(row.number).padStart(6, "0")}`;
const selectDocument = `SELECT d.*,e.version,e.amount,e.due_date,e.paid_date,e.account_id,e.card_id,e.category_id,e.notes,e.deleted_at FROM business_documents d JOIN entries e ON e.id=d.entry_id`;
export function registerBusinessRoutes({
  app,
  db,
  write,
  run,
  audit,
  entryValues,
}) {
  app.use(
    [
      "/api/s/:sid/documents",
      "/api/s/:sid/products",
      "/api/s/:sid/business-profile",
      "/api/s/:sid/business-summary",
      "/api/s/:sid/documents.csv",
    ],
    run(async (req, res, next) => {
      if (req.spaceKind !== "business")
        throw error("Esta função pertence ao ambiente da doceria", 403);
      next();
    }),
  );
  const find = async (client, req, id, lock = false) => {
    if (!validId(id)) throw error("Documento inválido");
    const row = (
      await client.query(
        `${selectDocument} WHERE d.id=$1 AND d.space_id=$2${lock ? " FOR UPDATE OF e,d" : ""}`,
        [id, req.sid],
      )
    ).rows[0];
    if (!row) throw error("Documento não encontrado", 404);
    return { ...row, code: documentNumber(row) };
  };
  const prepare = async (client, req, original = null) => {
    const b = req.body;
    if (
      !["sale", "purchase"].includes(b.kind) ||
      (original && b.kind !== original.kind)
    )
      throw error("Tipo de documento inválido");
    if (!validDate(b.issued_date) || b.issued_date > todayBR())
      throw error("Informe a data da venda ou compra, até hoje");
    if (!validId(b.party_id))
      throw error("Selecione a cafeteria ou o fornecedor");
    const party = (
      await client.query(
        "SELECT id,name,kind,document,address FROM contacts WHERE id=$1 AND space_id=$2 FOR SHARE",
        [b.party_id, req.sid],
      )
    ).rows[0];
    if (!party || party.kind !== (b.kind === "sale" ? "customer" : "supplier"))
      throw error("Selecione um cliente ou fornecedor deste ambiente");
    const profile = (
      await client.query(
        "SELECT name,document,address,phone FROM business_profiles WHERE space_id=$1 FOR SHARE",
        [req.sid],
      )
    ).rows[0];
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100)
      throw error("Adicione entre 1 e 100 itens");
    let total = 0n;
    const items = [];
    for (const item of b.items) {
      if (!item || !validId(item.product_id))
        throw error("Selecione um item válido");
      const p = (
        await client.query(
          "SELECT * FROM products WHERE id=$1 AND space_id=$2 FOR SHARE",
          [item.product_id, req.sid],
        )
      ).rows[0];
      // An existing snapshot remains editable even after the catalog item is removed.
      const snapshot = original?.items.find(
        (x) => String(x.product_id) === String(item.product_id),
      );
      const product = p || snapshot;
      if (
        !product ||
        (p && p.kind !== (b.kind === "sale" ? "product" : "material"))
      )
        throw error("Item não pertence a este tipo de documento ou ambiente");
      const values = lineValue(item.quantity, item.unit_price);
      if (product.unit === "un" && Number(values.quantity) % 1 !== 0)
        throw error("Itens em unidades exigem quantidade inteira");
      total += BigInt(values.total.replace(".", ""));
      items.push({
        product_id: String(item.product_id),
        name: product.name,
        unit: product.unit,
        ...values,
      });
    }
    if (total > 99999999999999n)
      throw error("Total do documento fora do intervalo permitido");
    const reference = safeText(b.reference, 150, "Referência");
    const kind = b.kind === "sale" ? "income" : "expense";
    let categoryId = b.category_id;
    if (!categoryId) {
      categoryId = (
        await client.query(
          "SELECT id FROM categories WHERE space_id=$1 AND kind=$2 ORDER BY (name=$3) DESC,id LIMIT 1",
          [req.sid, kind, b.kind === "sale" ? "Vendas" : "Ingredientes"],
        )
      ).rows[0]?.id;
    }
    const amount = centsText(total);
    const entry = await entryValues(client, {
      ...req,
      body: {
        description: `${b.kind === "sale" ? "Venda" : "Compra"} · ${party.name}`,
        kind,
        amount,
        due_date: b.due_date || b.issued_date,
        paid_date: b.paid_date,
        account_id: b.account_id,
        card_id: b.kind === "purchase" ? b.card_id : null,
        category_id: categoryId,
        contact_id: party.id,
        cost_center:
          b.kind === "sale" ? "Vendas para cafeterias" : "Compras de materiais",
        notes: safeText(b.notes, 1500, "Observações"),
      },
    });
    return { entry, items, party, profile, reference, amount };
  };
  app.get(
    "/api/s/:sid/business-profile",
    run(async (req, res) =>
      res.json(
        (
          await db.query("SELECT * FROM business_profiles WHERE space_id=$1", [
            req.sid,
          ])
        ).rows[0],
      ),
    ),
  );
  app.put(
    "/api/s/:sid/business-profile",
    run(async (req, res) =>
      write(req, res, async (client) => {
        if (!validId(req.body.version))
          throw error("Atualize os dados da doceria");
        const before = (
          await client.query(
            "SELECT * FROM business_profiles WHERE space_id=$1 FOR UPDATE",
            [req.sid],
          )
        ).rows[0];
        const fields = ["name", "document", "address", "phone"];
        const values = fields.map((f) =>
          safeText(
            req.body[f],
            f === "address" ? 300 : f === "name" ? 150 : 50,
            f,
            f === "name",
          ),
        );
        const row = (
          await client.query(
            "UPDATE business_profiles SET name=$2,document=$3,address=$4,phone=$5,version=version+1 WHERE space_id=$1 AND version=$6 RETURNING *",
            [req.sid, ...values, req.body.version],
          )
        ).rows[0];
        if (!row)
          throw error("Os dados da doceria mudaram. Atualize a página.", 409);
        await audit(
          client,
          req,
          "update",
          "business_profiles",
          row.id,
          before,
          row,
        );
        return row;
      }),
    ),
  );
  app.get(
    "/api/s/:sid/documents",
    run(async (req, res) => {
      const { from, to, kind, offset = 0, limit = 100 } = req.query;
      if (kind != null && !["sale", "purchase"].includes(kind))
        throw error("Tipo inválido");
      if (
        (from != null && !validDate(from)) ||
        (to != null && !validDate(to)) ||
        (from && to && from > to)
      )
        throw error("Período inválido");
      if (
        !/^\d+$/.test(String(offset)) ||
        !Number.isSafeInteger(Number(offset)) ||
        !/^\d+$/.test(String(limit)) ||
        Number(limit) < 1 ||
        Number(limit) > 100
      )
        throw error("Paginação inválida");
      const args = [req.sid],
        where = ["d.space_id=$1", "e.deleted_at IS NULL"];
      for (const [column, value, op] of [
        ["d.kind", kind, "="],
        ["d.issued_date", from, ">="],
        ["d.issued_date", to, "<="],
      ])
        if (value != null) {
          args.push(value);
          where.push(`${column}${op}$${args.length}`);
        }
      args.push(Number(limit), Number(offset));
      const rows = (
        await db.query(
          `${selectDocument} WHERE ${where.join(" AND ")} ORDER BY d.issued_date DESC,d.id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
          args,
        )
      ).rows;
      res.json(rows.map((r) => ({ ...r, code: documentNumber(r) })));
    }),
  );
  app.get(
    "/api/s/:sid/documents/:id",
    run(async (req, res) => res.json(await find(db, req, req.params.id))),
  );
  app.post(
    "/api/s/:sid/documents",
    run(async (req, res) =>
      write(
        req,
        res,
        async (client) => {
          const v = await prepare(client, req);
          const e = v.entry;
          const entry = (
            await client.query(
              "INSERT INTO entries(space_id,description,kind,amount,due_date,paid_date,account_id,card_id,category_id,contact_id,cost_center,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
              [
                req.sid,
                e.description,
                e.kind,
                e.amount,
                e.due_date,
                e.paid_date,
                e.account_id,
                e.card_id,
                e.category_id,
                e.contact_id,
                e.cost_center,
                e.notes,
                req.user.id,
              ],
            )
          ).rows[0];
          const number = (
            await client.query(
              "INSERT INTO document_counters(space_id,kind,last_value) VALUES($1,$2,1) ON CONFLICT(space_id,kind) DO UPDATE SET last_value=document_counters.last_value+1 RETURNING last_value",
              [req.sid, req.body.kind],
            )
          ).rows[0].last_value;
          const row = (
            await client.query(
              "INSERT INTO business_documents(space_id,entry_id,number,kind,issued_date,party_id,party_snapshot,issuer_snapshot,items,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
              [
                req.sid,
                entry.id,
                number,
                req.body.kind,
                req.body.issued_date,
                v.party.id,
                JSON.stringify(v.party),
                JSON.stringify(v.profile),
                JSON.stringify(v.items),
                v.reference,
              ],
            )
          ).rows[0];
          await audit(client, req, "create", "entries", entry.id, null, entry);
          await audit(
            client,
            req,
            "create",
            "business_documents",
            row.id,
            null,
            row,
          );
          return {
            ...row,
            ...{
              version: entry.version,
              amount: entry.amount,
              paid_date: entry.paid_date,
            },
            code: documentNumber(row),
          };
        },
        201,
      ),
    ),
  );
  app.put(
    "/api/s/:sid/documents/:id",
    run(async (req, res) =>
      write(req, res, async (client) => {
        const before = await find(client, req, req.params.id, true);
        if (
          before.deleted_at ||
          !validId(req.body.version) ||
          Number(before.version) !== Number(req.body.version)
        )
          throw error(
            "O documento mudou ou está na lixeira. Atualize a página.",
            409,
          );
        const v = await prepare(client, req, before),
          e = v.entry;
        await client.query(
          "UPDATE entries SET description=$2,kind=$3,amount=$4,due_date=$5,paid_date=$6,account_id=$7,card_id=$8,category_id=$9,contact_id=$10,cost_center=$11,notes=$12,version=version+1 WHERE id=$1",
          [
            before.entry_id,
            e.description,
            e.kind,
            e.amount,
            e.due_date,
            e.paid_date,
            e.account_id,
            e.card_id,
            e.category_id,
            e.contact_id,
            e.cost_center,
            e.notes,
          ],
        );
        await client.query(
          "UPDATE business_documents SET issued_date=$2,party_id=$3,party_snapshot=$4,items=$5,reference=$6 WHERE id=$1",
          [
            before.id,
            req.body.issued_date,
            v.party.id,
            JSON.stringify(v.party),
            JSON.stringify(v.items),
            v.reference,
          ],
        );
        const row = await find(client, req, before.id);
        await audit(
          client,
          req,
          "update",
          "business_documents",
          row.id,
          before,
          row,
        );
        return row;
      }),
    ),
  );
  app.post(
    "/api/s/:sid/documents/:id/payment",
    run(async (req, res) =>
      write(req, res, async (client) => {
        const before = await find(client, req, req.params.id, true);
        if (
          before.deleted_at ||
          !validId(req.body.version) ||
          Number(before.version) !== Number(req.body.version)
        )
          throw error("O documento mudou. Atualize a página.", 409);
        const date = req.body.paid_date || null;
        if (date && (!validDate(date) || date > todayBR()))
          throw error("Data de pagamento inválida");
        const account =
          "account_id" in req.body
            ? req.body.account_id || null
            : before.account_id;
        if (
          account &&
          (!validId(account) ||
            !(
              await client.query(
                "SELECT id FROM accounts WHERE id=$1 AND space_id=$2 FOR SHARE",
                [account, req.sid],
              )
            ).rowCount)
        )
          throw error("Selecione uma conta deste ambiente");
        if (account && before.card_id)
          throw error(
            "Compra no cartão não permite conta de pagamento neste lançamento",
          );
        await client.query(
          "UPDATE entries SET paid_date=$2,account_id=$3,version=version+1 WHERE id=$1",
          [before.entry_id, date, account],
        );
        const row = await find(client, req, before.id);
        await audit(
          client,
          req,
          "update",
          "business_documents",
          row.id,
          before,
          row,
        );
        return row;
      }),
    ),
  );
  app.get(
    "/api/s/:sid/documents/:id/pdf",
    run(async (req, res) => {
      const row = await find(db, req, req.params.id);
      const buffer = await documentPDF(row);
      res
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${row.code}.pdf"`,
        })
        .send(buffer);
    }),
  );
  app.get(
    "/api/s/:sid/documents.csv",
    run(async (req, res) => {
      const { from, to } = req.query;
      if (!validDate(from) || !validDate(to) || from > to)
        throw error("Período inválido");
      const rows = (
        await db.query(
          `${selectDocument} WHERE d.space_id=$1 AND d.issued_date BETWEEN $2 AND $3 AND e.deleted_at IS NULL ORDER BY d.issued_date,d.id`,
          [req.sid, from, to],
        )
      ).rows;
      const out = [
        [
          "Documento",
          "Tipo",
          "Data",
          "Cafeteria / fornecedor",
          "Referência",
          "Item",
          "Unidade",
          "Quantidade",
          "Preço unitário",
          "Total do item",
          "Vencimento",
          "Pagamento",
        ],
      ];
      for (const r of rows)
        for (const i of r.items)
          out.push([
            documentNumber(r),
            r.kind === "sale" ? "Venda" : "Compra",
            r.issued_date,
            r.party_snapshot.name,
            r.reference,
            i.name,
            i.unit,
            i.quantity.replace(".", ","),
            i.unit_price.replace(".", ","),
            i.total.replace(".", ","),
            r.due_date,
            r.paid_date,
          ]);
      res
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="itens-doceria-${from}.csv"`,
        })
        .send("\uFEFF" + out.map((r) => r.map(csvCell).join(";")).join("\r\n"));
    }),
  );
}

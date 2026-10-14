import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../server.js";
import { initialize } from "../database.js";
import { todayBR } from "../finance.js";
import { lineValue } from "../business.js";
let pg,
  db,
  app,
  agent,
  token,
  sid,
  home,
  customer,
  supplier,
  sweet,
  material,
  bank,
  sale,
  purchase;
let tail = Promise.resolve();
let failAudit = false;
const query = async (sql, args = []) => {
  if (failAudit && sql.startsWith("INSERT INTO audit"))
    throw Error("audit unavailable");
  const r = await pg.query(sql, args);
  return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
};
const connect = async () => {
  let release;
  const next = new Promise((r) => (release = r)),
    previous = tail;
  tail = next;
  await previous;
  return { query, release };
};
const write = (method, path, body, key = crypto.randomUUID(), space = sid) =>
  agent[method](`/api/s/${space}/${path}`)
    .set("X-CSRF-Token", token)
    .set("Idempotency-Key", key)
    .send(body);
const body = (kind = "sale", extra = {}) => ({
  kind,
  party_id: kind === "sale" ? customer.id : supplier.id,
  issued_date: todayBR(),
  due_date: todayBR(),
  account_id: bank.id,
  items: [
    {
      product_id: kind === "sale" ? sweet.id : material.id,
      quantity: kind === "sale" ? "3" : "1.250",
      unit_price: kind === "sale" ? "4.10" : "10.00",
    },
  ],
  ...extra,
});
before(async () => {
  pg = new PGlite({ parsers: { 1082: (v) => v } });
  await pg.waitReady;
  db = {
    connect,
    query: async (...args) => {
      const c = await connect();
      try {
        return await c.query(...args);
      } finally {
        c.release();
      }
    },
  };
  await initialize(db, {
    ADMIN_EMAIL: "business@example.com",
    ADMIN_PASSWORD: "long-isolated-test-password",
  });
  app = createApp({
    db,
    apiLimit: 10000,
    loginLimit: 100,
    logger: { error: () => {} },
  });
  agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({
      email: "business@example.com",
      password: "long-isolated-test-password",
    })
    .expect(200);
  const me = (await agent.get("/api/me").expect(200)).body;
  token = me.csrfToken;
  home = me.spaces.find((s) => s.kind === "home").id;
  sid = me.spaces.find((s) => s.kind === "business").id;
  customer = (
    await write("post", "contacts", {
      name: "Café de teste",
      kind: "customer",
      document: "00.000.000/0001-00",
      address: "Rua dos Testes, 10",
    }).expect(201)
  ).body;
  supplier = (
    await write("post", "contacts", {
      name: "Loja de teste",
      kind: "supplier",
    }).expect(201)
  ).body;
  sweet = (
    await write("post", "products", {
      name: "Brownie",
      kind: "product",
      unit: "un",
      default_price: "4.10",
    }).expect(201)
  ).body;
  material = (
    await write("post", "products", {
      name: "Chocolate",
      kind: "material",
      unit: "kg",
      default_price: "10",
    }).expect(201)
  ).body;
  bank = (
    await write("post", "accounts", {
      name: "Caixa da doceria",
      kind: "cash",
      opening: "0",
    }).expect(201)
  ).body;
});
after(async () => pg?.close());
test("quantidades fracionadas calculam centavos exatos, arredondam por item e rejeitam extremos", () => {
  assert.equal(lineValue("1.250", "10.00").total, "12.50");
  assert.equal(lineValue("0.333", "10.01").total, "3.33");
  assert.equal(lineValue("0.005", "1.00").total, "0.01");
  for (const q of ["0", "-1", "1.1234", "1e3", null, {}, "1,25"])
    assert.throws(() => lineValue(q, "1"));
  assert.throws(() => lineValue("999999999", "999999999999.99"));
  assert.throws(() => lineValue("0.001", "0.01"));
});
test("venda salva comprovante e uma receita; repetir requisição não duplica dinheiro ou número", async () => {
  const key = crypto.randomUUID();
  const b = body("sale", { amount: "9999", notes: "Entrega semanal" });
  sale = (await write("post", "documents", b, key).expect(201)).body;
  assert.equal(sale.amount, "12.30");
  assert.equal(sale.code, "ND-V000001");
  const repeated = (await write("post", "documents", b, key).expect(201)).body;
  assert.equal(repeated.id, sale.id);
  const e = (
    await db.query("SELECT * FROM entries WHERE id=$1", [sale.entry_id])
  ).rows[0];
  assert.equal(e.kind, "income");
  assert.equal(e.paid_date, null);
  assert.equal(
    (await db.query("SELECT * FROM business_documents")).rowCount,
    1,
  );
  const entries = (await agent.get(`/api/s/${sid}/entries`).expect(200)).body;
  assert.equal(entries[0].document_id, sale.id);
  const summary = (await agent.get(`/api/s/${sid}/summary`).expect(200)).body;
  assert.equal(summary.totals.find((t) => t.kind === "income").total, "12.30");
  await write("post", "documents", { ...b, notes: "Alterada" }, key).expect(
    409,
  );
});
test("compra guarda fornecedor, data, material, preço e quantidade e cria despesa", async () => {
  purchase = (
    await write(
      "post",
      "documents",
      body("purchase", {
        paid_date: todayBR(),
        reference: "NF fornecedor 123",
      }),
    ).expect(201)
  ).body;
  assert.equal(purchase.code, "ND-C000001");
  assert.equal(purchase.amount, "12.50");
  assert.equal(purchase.items[0].quantity, "1.250");
  assert.equal(purchase.party_snapshot.name, supplier.name);
  const e = (
    await db.query("SELECT * FROM entries WHERE id=$1", [purchase.entry_id])
  ).rows[0];
  assert.equal(e.kind, "expense");
  assert.equal(e.amount, "12.50");
  assert.equal(e.paid_date, todayBR());
  const summary = (await agent.get(`/api/s/${sid}/summary`).expect(200)).body;
  assert.equal(summary.accounts[0].balance, "-12.50");
});
test("doceria rejeita mistura de ambientes, tipos, quantidades, datas e acessos sem sessão", async () => {
  await agent.get(`/api/s/${home}/products`).expect(403);
  await write("post", "documents", body(), crypto.randomUUID(), home).expect(
    403,
  );
  await agent.get(`/api/s/${home}/documents/${sale.id}/pdf`).expect(403);
  await request(app).get(`/api/s/${sid}/documents/${sale.id}/pdf`).expect(401);
  const other = (
    await write(
      "post",
      "contacts",
      { name: "Pessoa da casa", kind: "customer" },
      crypto.randomUUID(),
      home,
    ).expect(201)
  ).body;
  const invalid = [
    { party_id: other.id },
    { party_id: supplier.id },
    { items: [{ product_id: material.id, quantity: "1", unit_price: "1" }] },
    { items: [{ product_id: sweet.id, quantity: "1.5", unit_price: "1" }] },
    { items: [] },
    { items: [{ product_id: sweet.id, quantity: "1", unit_price: "1.001" }] },
    { issued_date: "2026-02-30" },
    { kind: "transfer" },
    { account_id: "0" },
    { paid_date: "9999-01-01" },
    {
      items: Array(101).fill({
        product_id: sweet.id,
        quantity: "1",
        unit_price: "1",
      }),
    },
  ];
  for (const b of invalid)
    await write("post", "documents", body("sale", b)).expect(400);
  await agent.get(`/api/s/${sid}/documents?from=2026-02-30`).expect(400);
  await agent.get(`/api/s/${sid}/documents?limit=101`).expect(400);
  assert.equal(
    (await db.query("SELECT * FROM business_documents")).rowCount,
    2,
  );
});
test("recebimento, reabertura, edição e conflito de versão atualizam o mesmo lançamento", async () => {
  sale = (
    await write("post", `documents/${sale.id}/payment`, {
      version: sale.version,
      paid_date: todayBR(),
    }).expect(200)
  ).body;
  let summary = (await agent.get(`/api/s/${sid}/summary`).expect(200)).body;
  assert.equal(summary.accounts[0].balance, "-0.20");
  await write("post", `documents/${sale.id}/payment`, {
    version: 1,
    paid_date: todayBR(),
  }).expect(409);
  await write("put", `entries/${sale.entry_id}`, {
    description: "Fraude",
    kind: "income",
    amount: "999",
    due_date: todayBR(),
    version: sale.version,
  }).expect(409);
  const b = body("sale", {
    version: sale.version,
    items: [{ product_id: sweet.id, quantity: "4", unit_price: "4.10" }],
    paid_date: todayBR(),
  });
  sale = (await write("put", `documents/${sale.id}`, b).expect(200)).body;
  assert.equal(sale.amount, "16.40");
  assert.equal(sale.code, "ND-V000001");
  await write("put", `documents/${sale.id}`, b).expect(409);
  sale = (
    await write("post", `documents/${sale.id}/payment`, {
      version: sale.version,
      paid_date: null,
    }).expect(200)
  ).body;
  assert.equal(sale.paid_date, null);
  assert.equal((await db.query("SELECT * FROM entries")).rowCount, 2);
});
test("PDF, snapshots, dados da doceria e backup mantêm histórico e isolamento", async () => {
  await write("put", `products/${sweet.id}`, {
    name: sweet.name,
    kind: "product",
    unit: "kg",
    default_price: "4.10",
    version: sweet.version,
  }).expect(400);
  await write("put", `contacts/${customer.id}`, {
    name: customer.name,
    kind: "supplier",
    version: customer.version,
  }).expect(400);
  await write("put", `products/${sweet.id}`, {
    name: "Brownie novo",
    kind: "product",
    unit: "un",
    default_price: "9",
    version: sweet.version,
  }).expect(200);
  let profile = (await agent.get(`/api/s/${sid}/business-profile`).expect(200))
    .body;
  profile = (
    await write("put", "business-profile", {
      ...profile,
      name: "Nossas Delícias oficial",
      document: "12.345.678/0001-00",
    }).expect(200)
  ).body;
  const row = (
    await agent.get(`/api/s/${sid}/documents/${sale.id}`).expect(200)
  ).body;
  assert.equal(row.items[0].name, "Brownie");
  assert.equal(row.items[0].unit_price, "4.10");
  assert.equal(row.issuer_snapshot.name, "Nossas Delícias");
  const pdf = await agent
    .get(`/api/s/${sid}/documents/${sale.id}/pdf`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(pdf.headers["content-type"], /application\/pdf/);
  assert.match(pdf.headers["cache-control"], /no-store/);
  assert.ok(pdf.body.subarray(0, 4).equals(Buffer.from("%PDF")));
  const backup = (await agent.get(`/api/s/${sid}/backup.json`).expect(200))
    .body;
  assert.equal(backup.business_documents.length, 2);
  assert.equal(backup.products.length, 2);
  assert.equal(backup.document_counters.length, 2);
  assert.equal(backup.business_profiles[0].name, profile.name);
  assert.equal(backup.users, undefined);
  const homeBackup = (await agent.get(`/api/s/${home}/backup.json`).expect(200))
    .body;
  assert.equal(homeBackup.business_documents.length, 0);
  const csv = await agent
    .get(`/api/s/${sid}/documents.csv?from=${todayBR()}&to=${todayBR()}`)
    .expect(200);
  assert.match(csv.text, /Brownie/);
  assert.match(csv.text, /Chocolate/);
  assert.match(csv.text, /Loja de teste/);
});
test("lixeira e restauração retiram e devolvem receita e preservam itens e comprovante", async () => {
  await write("delete", `entries/${sale.entry_id}`, {
    version: sale.version,
  }).expect(200);
  const active = (await agent.get(`/api/s/${sid}/documents`).expect(200)).body;
  assert.equal(
    active.some((d) => d.id === sale.id),
    false,
  );
  const deleted = (
    await agent.get(`/api/s/${sid}/documents/${sale.id}`).expect(200)
  ).body;
  assert.ok(deleted.deleted_at);
  await write("post", `documents/${sale.id}/payment`, {
    version: deleted.version,
    paid_date: todayBR(),
  }).expect(409);
  const summary = (await agent.get(`/api/s/${sid}/summary`).expect(200)).body;
  assert.equal(
    summary.totals.some((t) => t.kind === "income"),
    false,
  );
  await write("post", `entries/${sale.entry_id}/restore`, {
    version: deleted.version,
  }).expect(200);
  const restored = (
    await agent.get(`/api/s/${sid}/documents/${sale.id}`).expect(200)
  ).body;
  assert.equal(restored.deleted_at, null);
  assert.equal(restored.items[0].name, "Brownie");
});
test("falha no meio da emissão reverte documento, receita, itens e contador", async () => {
  const before = (await db.query("SELECT COUNT(*) AS n FROM entries")).rows[0]
    .n;
  failAudit = true;
  await write("post", "documents", body()).expect(500);
  failAudit = false;
  assert.equal(
    (await db.query("SELECT COUNT(*) AS n FROM entries")).rows[0].n,
    before,
  );
  assert.equal(
    String(
      (
        await db.query(
          "SELECT last_value FROM document_counters WHERE space_id=$1 AND kind='sale'",
          [sid],
        )
      ).rows[0].last_value,
    ),
    "1",
  );
  const next = (await write("post", "documents", body()).expect(201)).body;
  assert.equal(next.code, "ND-V000002");
  assert.equal(next.issuer_snapshot.name, "Nossas Delícias oficial");
  await initialize(db, {
    ADMIN_EMAIL: "unused@example.com",
    ADMIN_PASSWORD: "unused-long-password",
  });
  assert.equal(
    (await db.query("SELECT * FROM business_documents")).rowCount,
    3,
  );
});

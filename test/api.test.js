import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../server.js";
import { initialize } from "../database.js";
import { hash, todayBR } from "../finance.js";

let pg, db, app, agent, token, sid, other, bank, destination, card;
const env = {
  ADMIN_EMAIL: "tests@example.com",
  ADMIN_PASSWORD: "a-long-password-for-tests",
};
const query = async (sql, args = []) => {
  const r = await pg.query(sql, args);
  return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
};
let tail = Promise.resolve();
async function connect() {
  let unlock;
  const next = new Promise((r) => (unlock = r)),
    previous = tail;
  tail = next;
  await previous;
  return { query, release: unlock };
}
const post = (path, body, key = crypto.randomUUID(), csrf = token) =>
  agent
    .post(`/api/s/${sid}/${path}`)
    .set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send(body);
const put = (path, body) =>
  agent
    .put(`/api/s/${sid}/${path}`)
    .set("X-CSRF-Token", token)
    .set("Idempotency-Key", crypto.randomUUID())
    .send(body);
const entry = (overrides = {}) => ({
  description: "Teste",
  kind: "expense",
  amount: "10.20",
  due_date: "2026-01-31",
  ...overrides,
});
before(async () => {
  pg = new PGlite({ parsers: { 1082: (value) => value } });
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
  await initialize(db, env);
  app = createApp({
    db,
    apiLimit: 10000,
    loginLimit: 100,
    logger: { error: () => {} },
  });
  agent = request.agent(app);
  const login = await agent
    .post("/api/login")
    .send({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
    .expect(200);
  assert.match(login.headers["set-cookie"][0], /HttpOnly/);
  assert.match(login.headers["set-cookie"][0], /SameSite=Strict/);
  const me = (await agent.get("/api/me").expect(200)).body;
  token = me.csrfToken;
  [sid, other] = me.spaces.map((x) => x.id);
  bank = (
    await post("accounts", {
      name: "Banco",
      kind: "bank",
      opening: "100.00",
    }).expect(201)
  ).body;
  destination = (
    await post("accounts", {
      name: "Caixa",
      kind: "cash",
      opening: "0",
    }).expect(201)
  ).body;
  card = (
    await post("cards", {
      name: "Cartão",
      credit_limit: "500",
      closing_day: 5,
      due_day: 10,
    }).expect(201)
  ).body;
});
after(async () => {
  await pg.close();
});

test("sessões exigidas, hash no banco e respostas sem cache", async () => {
  await request(app).get(`/api/s/${sid}/accounts`).expect(401);
  const me = await agent.get("/api/me").expect(200);
  assert.equal(me.headers["cache-control"], "no-store");
  assert.match(me.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(me.headers["x-powered-by"], undefined);
  const sessions = (await db.query("SELECT token FROM sessions")).rows;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token.length, 64);
  assert.notEqual(sessions[0].token, token);
  await request(app)
    .post("/api/login")
    .send({ email: env.ADMIN_EMAIL, password: "wrong" })
    .expect(401);
});
test("origem, JSON, CSRF e identificação de gravação obrigatórios", async () => {
  await agent.post(`/api/s/${sid}/entries`).send(entry()).expect(403);
  await post("entries", entry(), crypto.randomUUID(), "é".repeat(64)).expect(
    403,
  );
  await post("entries", entry())
    .set("Origin", "https://evil.example")
    .expect(403);
  await post("entries", entry())
    .set("Sec-Fetch-Site", "cross-site")
    .expect(403);
  await agent
    .post("/api/login")
    .type("form")
    .send({ email: env.ADMIN_EMAIL })
    .expect(415);
  await agent
    .post(`/api/s/${sid}/entries`)
    .set("X-CSRF-Token", token)
    .send(entry())
    .expect(400);
  await post("entries", entry())
    .set("Content-Type", "application/json")
    .send("{oops")
    .expect(400);
});
test("limite de tentativas de login e cookie seguro em produção", async () => {
  const limited = createApp({
    db,
    loginLimit: 2,
    production: true,
    publicOrigin: "https://app.example",
    logger: { error: () => {} },
  });
  for (let i = 0; i < 2; i++)
    await request(limited)
      .post("/api/login")
      .send({ email: env.ADMIN_EMAIL, password: "wrong" })
      .expect(401);
  await request(limited)
    .post("/api/login")
    .send({ email: env.ADMIN_EMAIL, password: "wrong" })
    .expect(429);
  const secure = createApp({
    db,
    production: true,
    publicOrigin: "https://app.example",
  });
  const r = await request(secure)
    .post("/api/login")
    .set("Origin", "https://app.example")
    .send({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
    .expect(200);
  assert.match(r.headers["set-cookie"][0], /; Secure;/);
});
test("valida datas reais, precisão monetária, textos e parcelas", async () => {
  for (const invalid of [
    { due_date: "2026-02-30" },
    { paid_date: "9999-01-01" },
    { amount: "10.123" },
    { amount: "1e3" },
    { amount: 0 },
    { amount: -1 },
    { description: {} },
    { installment_number: 2, installment_count: 1 },
    { installment_number: 1 },
    { installment_count: 1.5 },
  ])
    await post("entries", entry(invalid)).expect(400);
  await post(
    "entries",
    entry({ amount: "0.01", due_date: "2024-02-29" }),
  ).expect(201);
  await agent.get(`/api/s/${sid}/summary?from=invalid`).expect(400);
  await agent
    .get(`/api/s/${sid}/summary?from=2026-02-01&to=2026-01-01`)
    .expect(400);
  await post("cards", {
    name: "Bad",
    credit_limit: 1,
    closing_day: 32,
    due_day: 0,
  }).expect(400);
});
test("isola ambientes e referências, incluindo ids equivalentes", async () => {
  const foreign = (
    await agent
      .post(`/api/s/${other}/accounts`)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ name: "Outra conta", kind: "bank", opening: 0 })
      .expect(201)
  ).body;
  await post("entries", entry({ account_id: foreign.id })).expect(400);
  await agent.get("/api/s/999/accounts").expect(403);
  await post(
    "entries",
    entry({
      kind: "transfer",
      account_id: bank.id,
      to_account_id: "0" + bank.id,
    }),
  ).expect(400);
  await put(`accounts/${foreign.id}`, {
    name: "Hack",
    kind: "bank",
    opening: 0,
    version: 1,
  }).expect(409);
  const category = (
    await db.query(
      "SELECT id FROM categories WHERE space_id=$1 AND kind='income' LIMIT 1",
      [sid],
    )
  ).rows[0];
  await post("entries", entry({ category_id: category.id })).expect(400);
  await post("entries", entry({ kind: "income", card_id: card.id })).expect(
    400,
  );
  await post(
    "entries",
    entry({ account_id: bank.id, card_id: card.id }),
  ).expect(400);
});
test("repetir a mesma gravação não duplica lançamento nem auditoria", async () => {
  const key = crypto.randomUUID(),
    body = entry({ description: "Idempotente" });
  const a = await post("entries", body, key).expect(201),
    b = await post("entries", body, key).expect(201);
  assert.equal(a.body.id, b.body.id);
  assert.equal(
    (
      await db.query("SELECT id FROM audit WHERE entity=$1 AND entity_id=$2", [
        "entries",
        a.body.id,
      ])
    ).rowCount,
    1,
  );
  await post("entries", { ...body, amount: "20" }, key).expect(409);
});
test("edições simultâneas preservam a primeira versão", async () => {
  const row = (await post("entries", entry()).expect(201)).body;
  const a = await put(
    `entries/${row.id}`,
    entry({ description: "Novo", version: row.version }),
  ).expect(200);
  assert.equal(a.body.version, 2);
  await put(
    `entries/${row.id}`,
    entry({ description: "Desatualizado", version: row.version }),
  ).expect(409);
  const updated = await put(`accounts/${bank.id}`, {
    name: "Banco editado",
    kind: "bank",
    opening: "100",
    version: bank.version,
  }).expect(200);
  assert.equal(updated.body.name, "Banco editado");
  await put(`accounts/${bank.id}`, {
    name: "Stale",
    kind: "bank",
    opening: 0,
    version: bank.version,
  }).expect(409);
});
test("transferências liquidam contas sem alterar receitas ou despesas", async () => {
  const before = (
    await agent.get(`/api/s/${sid}/summary?from=2026-01-01&to=2026-01-31`)
  ).body;
  await post(
    "entries",
    entry({
      kind: "transfer",
      amount: "25.05",
      paid_date: todayBR(),
      account_id: bank.id,
      to_account_id: destination.id,
    }),
  ).expect(201);
  const after = (
    await agent.get(`/api/s/${sid}/summary?from=2026-01-01&to=2026-01-31`)
  ).body;
  const balance = (s, id) =>
    Number(s.accounts.find((x) => String(x.id) === String(id)).balance);
  assert.equal(balance(after, bank.id), balance(before, bank.id) - 25.05);
  assert.equal(
    balance(after, destination.id),
    balance(before, destination.id) + 25.05,
  );
  assert.deepEqual(
    before.totals.filter((x) => x.kind !== "transfer"),
    after.totals.filter((x) => x.kind !== "transfer"),
  );
});
test("parcelamento mensal conserva o valor e ajusta dias de meses curtos", async () => {
  const key = crypto.randomUUID(),
    body = entry({
      description: "Parcelado",
      installment_number: 1,
      installment_count: 3,
      generate_installments: true,
      paid_date: todayBR(),
    });
  const a = (await post("entries", body, key).expect(201)).body;
  assert.equal(a.created_count, 3);
  const rows = (
    await db.query(
      "SELECT * FROM entries WHERE installment_group=$1 ORDER BY installment_number",
      [a.installment_group],
    )
  ).rows;
  assert.deepEqual(
    rows.map((x) => String(x.due_date).slice(0, 10)),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.ok(rows.every((x) => x.amount === "10.20"));
  assert.equal(rows[1].paid_date, null);
  await post("entries", body, key).expect(201);
  assert.equal(
    (
      await db.query("SELECT id FROM entries WHERE installment_group=$1", [
        a.installment_group,
      ])
    ).rowCount,
    3,
  );
  await post(
    "entries",
    entry({
      generate_installments: true,
      installment_number: 2,
      installment_count: 3,
    }),
  ).expect(400);
  await post(
    "entries",
    entry({
      due_date: "9999-12-31",
      generate_installments: true,
      installment_number: 1,
      installment_count: 2,
    }),
  ).expect(400);
  assert.equal(
    (await db.query("SELECT id FROM entries WHERE due_date='9999-12-31'"))
      .rowCount,
    0,
  );
});
test("falha na auditoria reverte toda a transação", async () => {
  await db.query(
    "CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failure'; END $$",
  );
  await db.query(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_audit()",
  );
  const key = crypto.randomUUID();
  await post("entries", entry({ description: "Rollback" }), key).expect(500);
  assert.equal(
    (await db.query("SELECT id FROM entries WHERE description='Rollback'"))
      .rowCount,
    0,
  );
  assert.equal(
    (await db.query("SELECT key FROM write_requests WHERE key=$1", [key]))
      .rowCount,
    0,
  );
  await db.query("DROP TRIGGER reject_audit ON audit");
  await db.query("DROP FUNCTION reject_audit()");
});
test("pendências de outros meses e paginação não truncam o histórico", async () => {
  await db.query(
    "INSERT INTO entries(space_id,description,kind,amount,due_date) SELECT $1,'Paginação '||n,'expense',0.01,'2025-01-01' FROM generate_series(1,520) n",
    [sid],
  );
  const first = (
    await agent
      .get(
        `/api/s/${sid}/entries?from=2025-01-01&to=2025-01-31&limit=250&offset=0`,
      )
      .expect(200)
  ).body;
  const second = (
    await agent
      .get(
        `/api/s/${sid}/entries?from=2025-01-01&to=2025-01-31&limit=250&offset=250`,
      )
      .expect(200)
  ).body;
  const third = (
    await agent
      .get(
        `/api/s/${sid}/entries?from=2025-01-01&to=2025-01-31&limit=250&offset=500`,
      )
      .expect(200)
  ).body;
  assert.deepEqual([first.length, second.length, third.length], [250, 250, 20]);
  assert.equal(
    new Set([...first, ...second, ...third].map((x) => x.id)).size,
    520,
  );
  const pending = (
    await agent.get(`/api/s/${sid}/entries?pending=true&limit=500`).expect(200)
  ).body;
  assert.ok(pending.every((x) => !x.paid_date && x.kind !== "transfer"));
  assert.ok(pending.some((x) => String(x.due_date).startsWith("2025")));
  await agent.get(`/api/s/${sid}/entries?limit=501`).expect(400);
});
test("CSV completo ou mensal, português, vírgula decimal e fórmulas neutralizadas", async () => {
  await post(
    "entries",
    entry({
      description: '  =HYPERLINK("evil")',
      notes: "@formula",
      account_id: bank.id,
    }),
  ).expect(201);
  const csv = await agent
    .get(`/api/s/${sid}/export.csv?from=2026-01-01&to=2026-01-31`)
    .expect(200);
  assert.match(csv.text, /"Descrição"/);
  assert.match(csv.text, /"10,20"/);
  assert.match(csv.text, /"'=HYPERLINK/);
  assert.match(csv.text, /"'@formula"/);
  assert.match(csv.text, /Banco editado/);
  assert.doesNotMatch(csv.text, /Paginação/);
  const all = await agent.get(`/api/s/${sid}/export.csv`).expect(200);
  assert.match(all.text, /Paginação/);
});
test("categorias iniciais têm nome e tipo corretos e migração repara presets antigos", async () => {
  const categories = (
    await db.query("SELECT name,kind FROM categories WHERE space_id=$1", [sid])
  ).rows;
  assert.ok(
    categories.some((c) => c.name === "Alimentação" && c.kind === "expense"),
  );
  assert.ok(
    categories.some((c) => c.name === "Salário" && c.kind === "income"),
  );
  assert.ok(categories.every((c) => ["income", "expense"].includes(c.kind)));
  const legacy = (
    await db.query(
      "INSERT INTO categories(space_id,name,kind) VALUES($1,'expense','Ingredientes') RETURNING id",
      [other],
    )
  ).rows[0];
  await initialize(db, env);
  const repaired = (
    await db.query("SELECT name,kind FROM categories WHERE id=$1", [legacy.id])
  ).rows[0];
  assert.deepEqual(repaired, { name: "Ingredientes", kind: "expense" });
});
test("reinicialização conserva usuários e não ressuscita categorias excluídas", async () => {
  const cat = (
    await db.query("SELECT id FROM categories WHERE space_id=$1 LIMIT 1", [sid])
  ).rows[0];
  await db.query("DELETE FROM categories WHERE id=$1", [cat.id]);
  const pass = (
    await db.query("SELECT pass FROM users WHERE email=$1", [env.ADMIN_EMAIL])
  ).rows[0].pass;
  await initialize(db, { ...env, ADMIN_PASSWORD: "different-long-password" });
  assert.equal(
    (await db.query("SELECT id FROM categories WHERE id=$1", [cat.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (await db.query("SELECT pass FROM users WHERE email=$1", [env.ADMIN_EMAIL]))
      .rows[0].pass,
    pass,
  );
});
test("logout revoga sessão e expiração impede novo acesso", async () => {
  await agent
    .post("/api/logout")
    .set("X-CSRF-Token", token)
    .send({})
    .expect(200);
  await agent.get("/api/me").expect(401);
  await agent
    .post("/api/login")
    .send({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
    .expect(200);
  await db.query("UPDATE sessions SET expires=NOW()-INTERVAL '1 day'");
  await agent.get("/api/me").expect(401);
});

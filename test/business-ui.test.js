import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { todayBR } from "../finance.js";
test("interface da doceria: catálogo, compra fracionada, venda, PDF, filtros e recebimento", async () => {
  const html = await readFile(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    ),
    script = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
  const errors = [],
    requests = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html.replace(/<script[^>]*src[^>]*><\/script>/g, ""), {
    url: "https://app.example",
    runScripts: "dangerously",
    virtualConsole: vc,
  });
  const w = dom.window,
    $ = (s) => w.document.querySelector(s),
    date = todayBR();
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.matchMedia = () => ({ matches: true, addEventListener: () => {} });
  w.confirm = () => true;
  const profile = {
    id: "1",
    version: 1,
    name: "Nossas Delícias",
    document: "",
    address: "",
    phone: "",
  };
  const docs = [
    {
      id: "1",
      entry_id: "8",
      number: 1,
      code: "ND-V000001",
      kind: "sale",
      version: 1,
      issued_date: date,
      due_date: date,
      paid_date: null,
      amount: "12.30",
      party_id: "2",
      party_snapshot: { name: "Café teste <img src=x onerror=alert(1)>" },
      issuer_snapshot: profile,
      items: [
        {
          product_id: "1",
          name: "Brownie",
          unit: "un",
          quantity: "3",
          unit_price: "4.10",
          total: "12.30",
        },
      ],
    },
  ];
  const data = {
    products: [
      {
        id: "1",
        version: 1,
        name: "Brownie",
        kind: "product",
        unit: "un",
        default_price: "4.10",
      },
      {
        id: "2",
        version: 1,
        name: "Chocolate",
        kind: "material",
        unit: "kg",
        default_price: "10.00",
      },
    ],
    contacts: [
      { id: "2", version: 1, name: "Café teste", kind: "customer" },
      { id: "3", version: 1, name: "Atacadão teste", kind: "supplier" },
    ],
    accounts: [
      { id: "1", name: "Caixa", opening: "0", kind: "cash", version: 1 },
    ],
    cards: [],
    categories: [
      { id: "1", name: "Ingredientes", kind: "expense" },
      { id: "2", name: "Vendas", kind: "income" },
    ],
    audit: [],
    entries: [],
    summary: {
      totals: [],
      paidTotals: [],
      byCategory: [],
      accounts: [],
      cards: [],
      overdue: { count: 0, amount: "0" },
    },
    "business-profile": profile,
  };
  let fail = false;
  w.fetch = async (path, opts = {}) => {
    requests.push({ path, opts });
    let result,
      status = 200;
    if (path === "/api/me")
      result = {
        csrfToken: "a".repeat(64),
        user: { email: "tests@example.com" },
        spaces: [
          { id: "1", name: "Casa", kind: "home" },
          { id: "2", name: "Nossas Delícias", kind: "business" },
        ],
      };
    else if (opts.method && opts.method !== "GET") {
      if (fail) {
        fail = false;
        throw Error("Conexão interrompida");
      }
      result = { ok: true };
      if (path.endsWith("/payment")) {
        docs[0].paid_date = JSON.parse(opts.body).paid_date;
        docs[0].version++;
        result = docs[0];
      }
    } else if (/\/documents\/1$/.test(path)) result = docs[0];
    else if (path.includes("/documents?")) result = docs;
    else result = data[path.split("?")[0].split("/").at(-1)];
    return {
      status,
      ok: status < 400,
      json: async () => structuredClone(result),
    };
  };
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const click = (s) => $(s).click(),
    event = (s, type) =>
      $(s).dispatchEvent(
        new w.Event(type, { bubbles: true, cancelable: true }),
      );
  try {
    w.eval(script);
    await settle();
    assert.ok($("#nav [data-view=sales]").classList.contains("hidden"));
    click('[data-space="2"]');
    await settle();
    assert.equal(
      $("#nav [data-view=sales]").classList.contains("hidden"),
      false,
    );
    assert.ok($(".business-intro"));
    for (const view of [
      "sales",
      "purchases",
      "products",
      "contacts",
      "business-profile",
      "reports",
    ]) {
      click(`#nav [data-view="${view}"]`);
      assert.ok(!$("#content").textContent.includes("undefined"));
    }
    click("#nav [data-view=products]");
    click("#add");
    assert.equal($("[name=unit]").value, "un");
    assert.ok($("[name=kind] option[value=material]"));
    click("#cancel");
    click("#nav [data-view=purchases]");
    click("#add");
    $("[name=party_id]").value = "3";
    $("[data-product]").value = "2";
    event("[data-product]", "change");
    $("[data-quantity]").value = "1.250";
    event("[data-quantity]", "input");
    assert.match($("#document-total").textContent, /12,50/);
    assert.equal($("[data-quantity]").step, "0.001");
    event("#form", "submit");
    await settle();
    let last = requests.findLast((r) => r.opts.method === "POST");
    assert.equal(last.path, "/api/s/2/documents");
    let body = JSON.parse(last.opts.body);
    assert.equal(body.kind, "purchase");
    assert.deepEqual(body.items, [
      { product_id: "2", quantity: "1.250", unit_price: "10.00" },
    ]);
    assert.equal(body.issued_date, date);
    assert.equal(body.amount, undefined);
    click("#nav [data-view=sales]");
    assert.equal($("#content img"), null);
    assert.match($("a.button-link").href, /\/api\/s\/2\/documents\/1\/pdf$/);
    click("#add");
    $("[name=party_id]").value = "2";
    $("[data-product]").value = "1";
    event("[data-product]", "change");
    $("[data-quantity]").value = "3";
    event("[data-quantity]", "input");
    assert.match($("#document-total").textContent, /12,30/);
    assert.equal($("[data-quantity]").step, "1");
    click("#add-document-item");
    assert.equal($("#document-items").children.length, 2);
    click("#document-items .document-item:last-child .remove-line");
    assert.equal($("#document-items").children.length, 1);
    fail = true;
    event("#form", "submit");
    await settle();
    const failed = requests.findLast((r) => r.opts.method === "POST");
    assert.equal($("#dialog").open, true);
    assert.match($("#form-error").textContent, /Conexão/);
    event("#form", "submit");
    await settle();
    last = requests.findLast((r) => r.opts.method === "POST");
    assert.equal(
      last.opts.headers["Idempotency-Key"],
      failed.opts.headers["Idempotency-Key"],
    );
    assert.equal($("#dialog").open, false);
    $("#document-search").value = "não existe";
    event("#document-search", "input");
    assert.equal($(".document-row"), null);
    $("#document-search").value = "brownie";
    event("#document-search", "input");
    assert.ok($(".document-row"));
    click('[data-document-payment="1"]');
    await settle();
    assert.equal($("[name=paid_date]").value, date);
    $("[name=account_id]").value = "1";
    event("#form", "submit");
    await settle();
    last = requests.findLast((r) => r.opts.method === "POST");
    assert.equal(last.path, "/api/s/2/documents/1/payment");
    assert.equal(JSON.parse(last.opts.body).version, 1);
    assert.equal(JSON.parse(last.opts.body).account_id, "1");
    assert.match(
      $('[data-document-payment="1"]').textContent,
      /Alterar recebimento/,
    );
    assert.match($(".document-value").textContent, /Recebido/);
    click('[data-document-edit="1"]');
    await settle();
    assert.equal($("[data-product]").value, "1");
    assert.equal($("[data-quantity]").value, "3");
    event("#form", "submit");
    await settle();
    last = requests.findLast((r) => r.opts.method === "PUT");
    assert.equal(last.path, "/api/s/2/documents/1");
    assert.equal(JSON.parse(last.opts.body).version, 2);
    click("#nav [data-view=business-profile]");
    click("[data-edit-profile]");
    $("[name=name]").value = "Nossas Delícias oficial";
    event("#form", "submit");
    await settle();
    last = requests.findLast((r) => r.opts.method === "PUT");
    assert.equal(last.path, "/api/s/2/business-profile");
    click("#logout");
    await settle();
    event("#login-form", "submit");
    await settle();
    assert.equal($("#heading").textContent, "Visão geral");
    assert.ok($(".balance-band"));
    click('[data-space="1"]');
    await settle();
    assert.ok($("#nav [data-view=sales]").classList.contains("hidden"));
    assert.equal($(".business-intro"), null);
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});

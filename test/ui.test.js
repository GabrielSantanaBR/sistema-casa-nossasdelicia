import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { todayBR } from "../finance.js";

test("interface: navegação, cadastros, pendências, parcelas, falhas e sessão", async () => {
  const root = new URL("../public/", import.meta.url),
    html = await readFile(new URL("index.html", root), "utf8"),
    script = await readFile(new URL("app.js", root), "utf8");
  const errors = [],
    requests = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));
  const dom = new JSDOM(html.replace(/<script[^>]*src[^>]*><\/script>/g, ""), {
    url: "https://app.example",
    runScripts: "dangerously",
    virtualConsole: vc,
  });
  const w = dom.window,
    $ = (s) => w.document.querySelector(s),
    date = todayBR(),
    month = date.slice(0, 7);
  let failWrite = false,
    failLogout = false;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.matchMedia = () => ({ matches: true, addEventListener: () => {} });
  w.confirm = () => true;
  w.print = () => {};
  const entries = [
    {
      id: "1",
      version: 1,
      description: "Compra",
      kind: "expense",
      amount: "0.10",
      due_date: date,
      paid_date: date,
    },
    {
      id: "2",
      version: 1,
      description: "Internet",
      kind: "expense",
      amount: "0.20",
      due_date: date,
      paid_date: null,
    },
  ];
  const old = {
    id: "3",
    version: 1,
    description: "Pendente antiga",
    kind: "income",
    amount: "50.00",
    due_date: "2025-01-01",
    paid_date: null,
  };
  const data = {
    entries,
    accounts: [
      { id: "1", version: 1, name: "Banco", kind: "bank", opening: "100" },
    ],
    cards: [
      {
        id: "1",
        version: 1,
        name: "Cartão",
        credit_limit: "1000",
        closing_day: 5,
        due_day: 10,
      },
    ],
    categories: [
      { id: "1", version: 1, name: "Despesa", kind: "expense" },
      { id: "2", version: 1, name: "Receita", kind: "income" },
    ],
    contacts: [
      { id: "1", version: 1, name: "Pessoa", kind: "other", notes: "Nota" },
    ],
    audit: [],
    summary: {
      totals: [{ kind: "expense", total: "0.30" }],
      byCategory: [],
      accounts: [{ id: "1", name: "Banco", balance: "100" }],
      cards: [],
      overdue: { count: 1, amount: "50" },
    },
  };
  w.fetch = async (path, opts = {}) => {
    requests.push({ path, opts });
    let status = 200,
      result;
    if (path === "/api/me")
      result = {
        csrfToken: "a".repeat(64),
        user: { email: "tests@example.com" },
        spaces: [
          { id: "1", name: "Casa", kind: "home" },
          { id: "2", name: "Nossas Delícias", kind: "business" },
        ],
      };
    else if (path === "/api/logout") {
      status = failLogout ? 500 : 200;
      result = { error: "Falha ao sair" };
    } else if (opts.method && opts.method !== "GET") {
      if (failWrite) {
        failWrite = false;
        throw Error("Conexão interrompida");
      }
      result = {
        created_count:
          opts.body && JSON.parse(opts.body).generate_installments ? 3 : 1,
      };
    } else {
      const key = path.split("?")[0].split("/").at(-1);
      result =
        key === "entries"
          ? path.includes("pending=true")
            ? [entries[1], old]
            : entries
          : data[key];
    }
    return {
      status,
      ok: status < 400,
      json: async () => structuredClone(result),
    };
  };
  const settle = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    },
    click = (s) => $(s).click(),
    event = (s, type) =>
      $(s).dispatchEvent(
        new w.Event(type, { bubbles: true, cancelable: true }),
      );
  try {
    w.eval(script);
    await settle();
    assert.ok($(".balance-band"));
    assert.ok($("link[rel=icon]"));
    assert.equal($("#login .wordmark"), null);
    assert.equal($("#login .space-number"), null);
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") click("#theme");
      for (const view of [
        "overview",
        "entries",
        "bills",
        "accounts",
        "cards",
        "categories",
        "contacts",
        "reports",
        "audit",
      ]) {
        click("#nav [data-view=" + view + "]");
        assert.equal(
          $("#nav [data-view=" + view + "]").getAttribute("aria-current"),
          "page",
        );
        assert.ok(!$("#content").textContent.includes("undefined"));
      }
    }
    click("#nav [data-view=bills]");
    assert.equal($("#month"), null);
    assert.match($("#entry-results").textContent, /Pendente antiga/);
    assert.equal($("#status-filter option[value=paid]"), null);
    click('[data-settle="3"]');
    assert.equal($("[name=paid_date]").value, date);
    assert.equal($("[name=description]").value, old.description);
    event("#form", "submit");
    await settle();
    let last = requests.findLast((r) => r.opts.method === "PUT");
    assert.equal(last.path, "/api/s/1/entries/3");
    assert.equal(JSON.parse(last.opts.body).version, 1);
    assert.equal(last.opts.headers["X-CSRF-Token"], "a".repeat(64));
    for (const type of ["accounts", "cards", "categories", "contacts"]) {
      click("#nav [data-view=" + type + "]");
      click('[data-edit-asset="' + type + ':1"]');
      assert.equal($("[name=name]").value, data[type][0].name);
      event("#form", "submit");
      await settle();
      last = requests.findLast((r) => r.opts.method === "PUT");
      assert.equal(last.path, "/api/s/1/" + type + "/1");
      assert.equal(JSON.parse(last.opts.body).version, 1);
    }
    click("#add");
    $("[name=kind]").value = "income";
    event("[name=kind]", "change");
    assert.ok(
      $("[name=card_id]").closest("label").classList.contains("hidden"),
    );
    assert.equal($('[name=category_id] option[value="1"]'), null);
    assert.ok($('[name=category_id] option[value="2"]'));
    $("[name=kind]").value = "transfer";
    event("[name=kind]", "change");
    assert.equal($("[name=account_id]").required, true);
    assert.equal($("[name=generate_installments]").disabled, true);
    $("[name=kind]").value = "expense";
    event("[name=kind]", "change");
    $("[name=description]").value = "Parcelado";
    $("[name=amount]").value = "50";
    $("[name=installment_number]").value = "1";
    $("[name=installment_count]").value = "3";
    $("[name=generate_installments]").checked = true;
    failWrite = true;
    event("#form", "submit");
    event("#form", "submit");
    await settle();
    assert.equal($("#dialog").open, true);
    assert.match($("#form-error").textContent, /Conexão interrompida/);
    const failed = requests.findLast((r) => r.opts.method === "POST");
    event("#form", "submit");
    await settle();
    last = requests.findLast((r) => r.opts.method === "POST");
    assert.equal(
      last.opts.headers["Idempotency-Key"],
      failed.opts.headers["Idempotency-Key"],
    );
    assert.equal(JSON.parse(last.opts.body).generate_installments, true);
    assert.equal($("#dialog").open, false);
    assert.match($("#toast").textContent, /3 parcelas/);
    click("#add");
    $("[name=description]").value = "Falha";
    $("[name=amount]").value = "1";
    failWrite = true;
    event("#form", "submit");
    await settle();
    const previous = requests.findLast((r) => r.opts.method === "POST");
    $("[name=amount]").value = "2";
    event("#form", "submit");
    await settle();
    assert.notEqual(
      requests.findLast((r) => r.opts.method === "POST").opts.headers[
        "Idempotency-Key"
      ],
      previous.opts.headers["Idempotency-Key"],
    );
    click("#nav [data-view=reports]");
    assert.equal($("#content tbody tr").children.length, 6);
    assert.ok($("#csv-all"));
    click('[data-space="2"]');
    await settle();
    click("#add");
    $("[name=description]").value = "Negócio";
    $("[name=amount]").value = "1";
    event("#form", "submit");
    await settle();
    assert.equal(
      requests.findLast((r) => r.opts.method === "POST").path,
      "/api/s/2/entries",
    );
    click("#menu");
    assert.equal($(".main").inert, true);
    assert.equal($("#sidebar").inert, false);
    click("#close-nav");
    assert.equal($(".main").inert, false);
    assert.equal($("#sidebar").inert, true);
    failLogout = true;
    click("#logout");
    await settle();
    assert.equal($("#app").classList.contains("hidden"), false);
    failLogout = false;
    click("#logout");
    await settle();
    assert.equal($("#login").classList.contains("hidden"), false);
    assert.equal($("#content").children.length, 0);
    assert.equal($("#account-email").textContent, "");
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});

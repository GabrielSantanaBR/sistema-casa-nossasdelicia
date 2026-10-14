const $ = (s) => document.querySelector(s),
  el = (tag, attrs = {}, children = []) => {
    const x = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs))
      k === "text"
        ? (x.textContent = v)
        : k === "class"
          ? (x.className = v)
          : x.setAttribute(k, v);
    for (const c of children) x.append(c);
    return x;
  };
const money = (n) =>
    Number(n || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
  esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
const localDate = (d) => (d ? String(d).slice(0, 10) : ""),
  today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    return ["year", "month", "day"]
      .map((type) => parts.find((p) => p.type === type).value)
      .join("-");
  };
const displayDate = (d) =>
  d ? localDate(d).split("-").reverse().join("/") : "—";
const storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
const state = {
  csrfToken: null,
  pendingEntries: [],
  paymentEntries: [],
  trashEntries: [],
  user: null,
  spaces: [],
  space: null,
  view: "overview",
  summary: null,
  entries: [],
  accounts: [],
  cards: [],
  categories: [],
  contacts: [],
  products: [],
  documents: [],
  businessProfile: null,
  documentSearch: "",
  documentParty: "",
  documentStatus: "all",
  productKind: "all",
  audit: [],
  edit: null,
  mode: "entries",
  month: today().slice(0, 7),
  search: "",
  kind: "all",
  status: "all",
  order: "",
  dark: storage.get("theme") === "dark",
};
const endpoint = (p = "") => "/api/s/" + state.space.id + "/" + p;
async function api(path, opts = {}) {
  const { writeKey, ...options } = opts;
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    headers["X-CSRF-Token"] = state.csrfToken || "";
    if (path.startsWith("/api/s/"))
      headers["Idempotency-Key"] = writeKey || crypto.randomUUID();
  }
  const r = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  if (r.status === 401) {
    showLogin();
    throw Error("Sua sessão expirou");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "Não foi possível concluir");
  return data;
}
function notify(s) {
  $("#toast").textContent = s;
  $("#toast").classList.remove("hidden");
  setTimeout(() => $("#toast").classList.add("hidden"), 3500);
}
function showLogin() {
  closeNav();
  $("#dialog").close();
  closeSecurity();
  Object.assign(state, {
    user: null,
    view: "overview",
    space: null,
    spaces: [],
    edit: null,
    lastWritePayload: null,
    writeKey: null,
    csrfToken: null,
    summary: null,
    entries: [],
    pendingEntries: [],
    paymentEntries: [],
    trashEntries: [],
    accounts: [],
    cards: [],
    categories: [],
    contacts: [],
    products: [],
    documents: [],
    businessProfile: null,
    documentSearch: "",
    documentParty: "",
    documentStatus: "all",
    audit: [],
  });
  $("#form-fields").replaceChildren();
  $("#form-error").textContent = "";
  $("#content").replaceChildren();
  $("#account-email").textContent = "";
  loadVersion++;
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
}
async function boot() {
  document.body.classList.toggle("dark", state.dark);
  $("#today").textContent = new Date().toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  try {
    const r = await api("/api/me");
    state.csrfToken = r.csrfToken;
    state.sessionIdleHours = r.sessionIdleHours || 12;
    state.user = r.user;
    state.spaces = r.spaces;
    state.space = r.spaces[0];
    $("#account-email").textContent = r.user.email;
    showApp();
    await load();
  } catch {
    showLogin();
  }
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const d = Object.fromEntries(new FormData(e.target)),
    button = e.target.querySelector("[type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Entrando…";
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error || "Falha no login");
    e.target.reset();
    await boot();
  } catch (err) {
    $("#login-error").textContent = err.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Entrar <span aria-hidden="true">→</span>';
  }
});
$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
    showLogin();
  } catch (err) {
    notify(err.message);
  }
};
$("#theme").onclick = () => {
  state.dark = !state.dark;
  storage.set("theme", state.dark ? "dark" : "light");
  document.body.classList.toggle("dark", state.dark);
};
$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b && !$("#content").hasAttribute("aria-busy")) {
    if (
      ["sales", "purchases"].includes(b.dataset.view) &&
      state.view !== b.dataset.view
    ) {
      state.documentSearch = "";
      state.documentParty = "";
      state.documentStatus = "all";
    }
    if (b.dataset.view === "bills") {
      state.kind = "all";
      state.status = "all";
    }
    state.view = b.dataset.view;
    render();
  }
});
$("#spaces").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-space]");
  if (b) {
    state.space = state.spaces.find((s) => String(s.id) === b.dataset.space);
    state.view = "overview";
    state.search = "";
    state.kind = "all";
    state.status = "all";
    state.order = "";
    state.documentSearch = "";
    state.documentParty = "";
    state.documentStatus = "all";
    await load();
  }
});
$("#add").onclick = () =>
  state.space.kind === "business" &&
  ["overview", "sales", "purchases"].includes(state.view)
    ? openForm(
        "documents",
        null,
        state.view === "purchases" ? "purchase" : "sale",
      )
    : state.view === "products"
      ? openForm("products")
      : openForm("entries");
$("#close-dialog").onclick = $("#cancel").onclick = () => $("#dialog").close();
function period() {
  return {
    from: state.month + "-01",
    to:
      state.month +
      "-" +
      new Date(
        Number(state.month.slice(0, 4)),
        Number(state.month.slice(5, 7)),
        0,
      ).getDate(),
  };
}
let loadVersion = 0;
async function allDocuments(base) {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    const rows = await api(
      base +
        "documents?" +
        new URLSearchParams({ ...period(), limit: 100, offset }),
    );
    result.push(...rows);
    if (rows.length < 100) return result;
  }
}
async function allEntries(base, params = {}) {
  const result = [];
  for (let offset = 0; ; offset += 250) {
    const rows = await api(
      base +
        "entries?" +
        new URLSearchParams({ ...params, limit: 250, offset }),
    );
    result.push(...rows);
    if (rows.length < 250) return result;
  }
}

async function load() {
  const version = ++loadVersion;
  const base = endpoint();
  $("#content").innerHTML =
    '<div class="loading" role="status">Carregando suas contas…</div>';
  $("#content").setAttribute("aria-busy", "true");
  $("#add").disabled = true;
  document.querySelectorAll("#nav button").forEach((b) => (b.disabled = true));
  try {
    const [
      summary,
      entries,
      pendingEntries,
      paymentEntries,
      trashEntries,
      accounts,
      cards,
      categories,
      contacts,
      audit,
      products,
      documents,
      businessProfile,
    ] = await Promise.all([
      api(base + "summary?" + new URLSearchParams(period())),
      allEntries(base, period()),
      allEntries(base, { pending: true }),
      allEntries(base, { ...period(), basis: "payment" }),
      allEntries(base, { deleted: true }),
      api(base + "accounts"),
      api(base + "cards"),
      api(base + "categories"),
      api(base + "contacts"),
      api(base + "audit"),
      state.space.kind === "business"
        ? api(base + "products")
        : Promise.resolve([]),
      state.space.kind === "business"
        ? allDocuments(base)
        : Promise.resolve([]),
      state.space.kind === "business"
        ? api(base + "business-profile")
        : Promise.resolve(null),
    ]);
    if (version !== loadVersion) return;
    Object.assign(state, {
      summary,
      entries,
      pendingEntries,
      paymentEntries,
      trashEntries,
      accounts,
      cards,
      categories,
      contacts,
      audit,
      products,
      documents,
      businessProfile,
    });
    render();
  } catch (e) {
    if (version === loadVersion) {
      $("#content").innerHTML =
        '<div class="empty"><strong>Não foi possível carregar os dados.</strong><button id="retry">Tentar novamente</button></div>';
      $("#retry").onclick = load;
      notify(e.message);
    }
  } finally {
    if (version === loadVersion) {
      $("#content").removeAttribute("aria-busy");
      $("#add").disabled = false;
      document
        .querySelectorAll("#nav button")
        .forEach((b) => (b.disabled = false));
    }
  }
}
const sum = (kind) =>
  Number(state.summary?.totals?.find((x) => x.kind === kind)?.total || 0);
function table(head, rows) {
  return (
    '<div class="table-scroll"><table class="data-table"><thead><tr>' +
    head
      .map(
        (x) =>
          "<th" +
          (x.includes("col-date") ? ' class="col-date"' : "") +
          ">" +
          x +
          "</th>",
      )
      .join("") +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}
function section(title, body) {
  return '<section class="panel"><h3>' + title + "</h3>" + body + "</section>";
}
function simpleLine(a, b) {
  return (
    '<div class="listline"><span>' + esc(a) + "</span><b>" + b + "</b></div>"
  );
}
const kindNames = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  bank: "Conta bancária",
  cash: "Dinheiro",
  savings: "Poupança",
  investment: "Investimento",
  supplier: "Fornecedor",
  customer: "Cliente",
  other: "Outro",
};
const empty = (title, desc, type, label) =>
  '<div class="empty"><strong>' +
  title +
  "</strong>" +
  desc +
  (type
    ? '<button class="text-button" data-create="' +
      type +
      '">' +
      label +
      " →</button>"
    : "") +
  "</div>";
function entryRow(t, compact = false) {
  const cls =
      t.kind === "income" ? "positive" : t.kind === "expense" ? "negative" : "",
    kind = kindNames[t.kind],
    category = state.categories.find(
      (x) => String(x.id) === String(t.category_id),
    );
  const status = t.paid_date
    ? '<span class="tag good">Liquidado</span>'
    : localDate(t.due_date) < today()
      ? '<span class="tag warn">Atrasado</span>'
      : '<span class="tag">Pendente</span>';
  return (
    "<tr><td><b>" +
    esc(t.description) +
    '</b><div class="subtle">' +
    esc(category?.name || t.cost_center || kind) +
    '</div></td><td class="col-date">' +
    displayDate(t.due_date) +
    "</td>" +
    (!compact ? '<td class="col-kind">' + esc(kind) + "</td>" : "") +
    '<td class="amount ' +
    cls +
    '">' +
    (t.kind === "expense" ? "− " : t.kind === "income" ? "+ " : "") +
    money(t.amount) +
    "</td><td>" +
    status +
    '</td><td><div class="actions">' +
    (!t.paid_date && t.kind !== "transfer"
      ? '<button data-settle="' +
        t.id +
        '">' +
        (t.kind === "income" ? "Receber" : "Pagar") +
        "</button>"
      : "") +
    '<button data-edit="' +
    t.id +
    '" aria-label="Editar ' +
    esc(t.description) +
    '">Editar</button>' +
    (!compact
      ? '<button data-delete="' +
        t.id +
        '" aria-label="Excluir ' +
        esc(t.description) +
        '">Excluir</button>'
      : "") +
    "</div></td></tr>"
  );
}
function overview() {
  const s = state.summary,
    inc = sum("income"),
    exp = sum("expense"),
    pending = state.pendingEntries.filter(
      (t) => !t.paid_date && t.kind !== "transfer",
    ),
    recent = state.entries.slice(0, 6),
    categories = s.byCategory.filter((x) => x.kind === "expense"),
    total = categories.reduce((n, x) => n + Number(x.total), 0),
    due = [...pending]
      .sort((a, b) =>
        localDate(a.due_date).localeCompare(localDate(b.due_date)),
      )
      .slice(0, 4);
  return (
    (state.space.kind === "business" ? businessOverview() : "") +
    ('<section class="balance-band" aria-label="Resumo do mês"><div class="balance-main"><small>Resultado previsto do mês</small><strong>' +
      money(inc - exp) +
      '</strong><span class="hint">Receitas menos despesas · inclui pendências</span></div><div class="income"><small>Receitas previstas</small><strong>' +
      money(inc) +
      '</strong><span class="hint">Entradas do período</span></div><div class="expense"><small>Despesas previstas</small><strong>' +
      money(exp) +
      '</strong><span class="hint">Saídas do período</span></div></section><div class="dashboard-grid"><section class="panel overview-table"><div class="section-head"><h3>Movimentações do mês</h3><button class="text-button" data-go="entries">Ver todas →</button></div>' +
      (recent.length
        ? table(
            [
              "Descrição",
              '<span class="col-date">Vencimento</span>',
              "Valor",
              "Situação",
              "",
            ],
            recent.map((t) => entryRow(t, true)),
          )
        : empty(
            "O mês começa por aqui.",
            "Registre uma receita ou despesa para acompanhar os números.",
            "entries",
            "Criar primeiro lançamento",
          )) +
      '</section><div class="panel-stack"><section class="panel"><div class="section-head"><h3>A pagar e receber</h3><button class="text-button" data-go="bills">Ver →</button></div><div class="attention"><div><span class="muted">Pendentes · todos os meses</span><div class="subtle">' +
      s.overdue.count +
      " atrasados em todo o histórico</div></div><strong>" +
      pending.length +
      "</strong></div>" +
      (due.length
        ? due
            .map(
              (x) =>
                '<div class="due-item"><span class="date-tile">' +
                localDate(x.due_date).slice(-2) +
                "</span><div><b>" +
                esc(x.description) +
                '</b><div class="subtle">' +
                (x.kind === "income" ? "A receber" : "A pagar") +
                " · " +
                displayDate(x.due_date) +
                '</div></div><span class="amount">' +
                money(x.amount) +
                "</span></div>",
            )
            .join("")
        : '<p class="subtle">Nenhuma conta pendente.</p>') +
      '</section><section class="panel"><h3>Para onde vai o dinheiro</h3>' +
      (categories.length
        ? categories
            .map(
              (x) =>
                '<div class="category-item"><div class="listline"><span>' +
                esc(x.label) +
                "</span><b>" +
                money(x.total) +
                '</b></div><div class="bar"><span style="width:' +
                Math.round((100 * Number(x.total)) / total) +
                '%"></span></div></div>',
            )
            .join("")
        : empty(
            "Sem despesas por enquanto.",
            "As categorias aparecem conforme você registra seus gastos.",
          )) +
      '</section></div></div><div class="dashboard-bottom"><section class="panel"><div class="section-head"><h3>Contas e caixas</h3><button class="text-button" data-go="accounts">Gerenciar →</button></div>' +
      (s.accounts.length
        ? s.accounts.map((x) => simpleLine(x.name, money(x.balance))).join("")
        : empty(
            "Onde você movimenta seu dinheiro?",
            "Cadastre um banco ou caixa para acompanhar o saldo.",
            "accounts",
            "Adicionar conta",
          )) +
      '</section><section class="panel"><div class="section-head"><h3>Compras no cartão</h3><button class="text-button" data-go="cards">Gerenciar →</button></div>' +
      (s.cards.length
        ? s.cards.map((x) => simpleLine(x.name, money(x.purchases))).join("") +
          '<p class="subtle">Compras lançadas neste mês. Não representa uma fatura automática.</p>'
        : empty(
            "Seus cartões, organizados.",
            "Cadastre limite, fechamento e vencimento.",
            "cards",
            "Adicionar cartão",
          )) +
      "</section></div>")
  );
}
function filteredEntries(bills = false) {
  const rows = (bills ? state.pendingEntries : state.entries).filter(
    (t) =>
      (!bills || (!t.paid_date && t.kind !== "transfer")) &&
      (state.kind === "all" || t.kind === state.kind) &&
      (state.status === "all" ||
        (state.status === "paid" && t.paid_date) ||
        (state.status === "pending" && !t.paid_date) ||
        (state.status === "overdue" &&
          !t.paid_date &&
          localDate(t.due_date) < today())) &&
      (!state.search ||
        (
          t.description +
          " " +
          t.cost_center +
          " " +
          (state.categories.find((c) => String(c.id) === String(t.category_id))
            ?.name || "")
        )
          .toLocaleLowerCase("pt-BR")
          .includes(state.search.toLocaleLowerCase("pt-BR"))),
  );
  const order = state.order || (bills ? "due-asc" : "due-desc");
  return rows.sort((a, b) =>
    order === "amount-desc"
      ? Number(b.amount) - Number(a.amount)
      : order === "amount-asc"
        ? Number(a.amount) - Number(b.amount)
        : order === "name"
          ? a.description.localeCompare(b.description, "pt-BR")
          : (order === "due-asc" ? 1 : -1) *
            localDate(a.due_date).localeCompare(localDate(b.due_date)),
  );
}
function entryTable(bills) {
  const rows = filteredEntries(bills);
  return rows.length
    ? table(
        ["Descrição", "Vencimento", "Tipo", "Valor", "Situação", "Ações"],
        rows.map((t) => entryRow(t)),
      )
    : empty(
        "Nenhum lançamento encontrado.",
        bills
          ? "Todas as pendências do histórico aparecem aqui. Confira os filtros."
          : "Confira o mês e os filtros ou registre uma movimentação.",
        "entries",
        "Novo lançamento",
      );
}
function entriesView(bills = false) {
  return (
    '<div class="toolbar"><p id="entry-count">' +
    filteredEntries(bills).length +
    ' lançamentos</p><div class="filters"><input id="search" type="search" placeholder="Buscar descrição ou categoria" aria-label="Buscar lançamentos" value="' +
    esc(state.search) +
    '"><select id="kind-filter" aria-label="Filtrar tipo">' +
    [
      ["all", "Todos os tipos"],
      ["expense", "Despesas"],
      ["income", "Receitas"],
      ["transfer", "Transferências"],
    ]
      .filter(([v]) => !bills || !["transfer", "paid"].includes(v))
      .map(
        ([v, l]) =>
          '<option value="' +
          v +
          '" ' +
          (state.kind === v ? "selected" : "") +
          ">" +
          l +
          "</option>",
      )
      .join("") +
    '</select><select id="status-filter" aria-label="Filtrar situação">' +
    [
      ["all", "Todas as situações"],
      ["pending", "Pendentes"],
      ["paid", "Liquidados"],
      ["overdue", "Atrasados"],
    ]
      .filter(([v]) => !bills || !["transfer", "paid"].includes(v))
      .map(
        ([v, l]) =>
          '<option value="' +
          v +
          '" ' +
          (state.status === v ? "selected" : "") +
          ">" +
          l +
          "</option>",
      )
      .join("") +
    '</select><select id="sort-filter" aria-label="Ordenar lançamentos">' +
    [
      ["due-asc", "Vencimento: mais próximo"],
      ["due-desc", "Vencimento: mais distante"],
      ["amount-desc", "Maior valor"],
      ["amount-asc", "Menor valor"],
      ["name", "Descrição: A a Z"],
    ]
      .map(
        ([value, label]) =>
          '<option value="' +
          value +
          '" ' +
          ((state.order || (bills ? "due-asc" : "due-desc")) === value
            ? "selected"
            : "") +
          ">" +
          label +
          "</option>",
      )
      .join("") +
    '</select></div></div><section class="panel" id="entry-results">' +
    entryTable(bills) +
    "</section>"
  );
}
function assets(type) {
  const items = state[type],
    labels = {
      accounts: ["Nova conta", "Saldo inicial"],
      cards: ["Novo cartão", "Limite cadastrado"],
      categories: ["Nova categoria", ""],
      contacts: ["Novo contato", ""],
    };
  return (
    '<div class="toolbar"><p>' +
    items.length +
    " " +
    {
      accounts: "contas",
      cards: "cartões",
      categories: "categorias",
      contacts: "contatos",
    }[type] +
    ' neste ambiente</p><button class="primary" data-create="' +
    type +
    '">+ ' +
    labels[type][0] +
    '</button></div><section class="panel asset-list">' +
    (items.length
      ? items
          .map((x) => {
            const balance = state.summary.accounts.find(
              (a) => String(a.id) === String(x.id),
            )?.balance;
            return (
              '<div class="asset-row"><div><h3>' +
              esc(x.name) +
              '</h3><span class="subtle">' +
              (type === "cards"
                ? "Fecha dia " + x.closing_day + " · Vence dia " + x.due_day
                : esc(kindNames[x.kind] || x.kind)) +
              '</span></div><div class="asset-value">' +
              (["accounts", "cards"].includes(type)
                ? "<strong>" +
                  money(
                    type === "cards" ? x.credit_limit : (balance ?? x.opening),
                  ) +
                  '</strong><span class="subtle">' +
                  (type === "cards" ? "Limite cadastrado" : "Saldo atual") +
                  "</span>"
                : type === "contacts"
                  ? '<span class="subtle">' + esc(x.notes) + "</span>"
                  : "") +
              '</div><div class="actions"><button data-edit-asset="' +
              type +
              ":" +
              x.id +
              '" aria-label="Editar ' +
              esc(x.name) +
              '">Editar</button><button data-remove="' +
              type +
              ":" +
              x.id +
              '" aria-label="Excluir ' +
              esc(x.name) +
              '">Excluir</button></div></div>'
            );
          })
          .join("")
      : empty(
          "Comece com seu primeiro cadastro.",
          "Ele ficará disponível nos lançamentos deste ambiente.",
          type,
          labels[type][0],
        )) +
    "</section>"
  );
}
function reports() {
  const inc = sum("income"),
    exp = sum("expense"),
    paidInc = Number(
      state.summary.paidTotals?.find((x) => x.kind === "income")?.total || 0,
    ),
    paidExp = Number(
      state.summary.paidTotals?.find((x) => x.kind === "expense")?.total || 0,
    );
  return (
    (state.space.kind === "business" ? businessReport() : "") +
    ('<div class="button-row"><button class="primary" id="csv">↓ Exportar mês (CSV)</button><button id="csv-paid">Exportar pagamentos do mês</button><button id="backup">Baixar cópia de segurança</button><button id="csv-all">Exportar histórico completo</button><button id="print">Imprimir esta página</button></div><div class="guide">Previsões usam o vencimento; valores recebidos e liquidados usam a data do pagamento, mesmo quando o vencimento pertence a outro mês. Escolha exportar o mês ou o histórico completo do ambiente atual. Compras no cartão devem ser lançadas uma única vez para não duplicar despesas.</div><div class="panels">' +
      section(
        "Demonstrativo do período",
        simpleLine("Receitas previstas", money(inc)) +
          simpleLine("Despesas previstas", money(exp)) +
          simpleLine(
            "Resultado previsto",
            "<strong>" + money(inc - exp) + "</strong>",
          ) +
          simpleLine("Receitas recebidas no mês", money(paidInc)) +
          simpleLine("Despesas liquidadas no mês", money(paidExp)) +
          simpleLine("Resultado liquidado", money(paidInc - paidExp)),
      ) +
      section(
        "Pendências e exposição",
        simpleLine(
          "Despesas em aberto",
          money(
            state.entries
              .filter((x) => x.kind === "expense" && !x.paid_date)
              .reduce((a, x) => a + Math.round(Number(x.amount) * 100), 0) /
              100,
          ),
        ) +
          simpleLine(
            "Receitas a receber",
            money(
              state.entries
                .filter((x) => x.kind === "income" && !x.paid_date)
                .reduce((a, x) => a + Math.round(Number(x.amount) * 100), 0) /
                100,
            ),
          ) +
          simpleLine(
            "Valores atrasados (histórico)",
            money(state.summary.overdue.amount),
          ),
      ) +
      "</div>" +
      section(
        "Lançamentos por vencimento",
        table(
          ["Descrição", "Vencimento", "Tipo", "Valor", "Situação", ""],
          state.entries.map((t) => entryRow(t)),
        ),
      ) +
      section(
        "Pagamentos e recebimentos no mês",
        state.paymentEntries.length
          ? table(
              ["Descrição", "Pagamento", "Vencimento", "Tipo", "Valor"],
              state.paymentEntries.map(
                (t) =>
                  "<tr><td>" +
                  esc(t.description) +
                  "</td><td>" +
                  displayDate(t.paid_date) +
                  "</td><td>" +
                  displayDate(t.due_date) +
                  "</td><td>" +
                  esc(kindNames[t.kind]) +
                  '</td><td class="amount">' +
                  money(t.amount) +
                  "</td></tr>",
              ),
            )
          : empty(
              "Nenhum pagamento registrado.",
              "Informe a data de pagamento ao liquidar um lançamento.",
            ),
      ))
  );
}
function trashView() {
  return (
    '<div class="guide">Lançamentos na lixeira ficam fora dos saldos e relatórios. Restaure um item para recuperar seu efeito nas contas. Cada parcela é restaurada individualmente.</div>' +
    section(
      "Lançamentos removidos",
      state.trashEntries.length
        ? table(
            ["Descrição", "Valor", "Removido em", "Ações"],
            state.trashEntries.map(
              (t) =>
                "<tr><td>" +
                esc(t.description) +
                '<div class="subtle">' +
                displayDate(t.due_date) +
                " · " +
                esc(kindNames[t.kind]) +
                '</div></td><td class="amount">' +
                money(t.amount) +
                "</td><td>" +
                new Date(t.deleted_at).toLocaleString("pt-BR") +
                '</td><td><button data-restore="' +
                t.id +
                '">Restaurar</button></td></tr>',
            ),
          )
        : empty(
            "A lixeira está vazia.",
            "Os lançamentos removidos poderão ser recuperados aqui.",
          ),
    )
  );
}
function auditDetails(row) {
  const before = row.before_data || {},
    after = row.after_data || {},
    labels = {
      description: "Descrição",
      kind: "Tipo",
      amount: "Valor",
      due_date: "Vencimento",
      paid_date: "Pagamento",
      name: "Nome",
      opening: "Saldo inicial",
      credit_limit: "Limite",
      closing_day: "Fechamento",
      due_day: "Vencimento do cartão",
      cost_center: "Centro de custo",
      notes: "Observações",
      installment_number: "Parcela",
      installment_count: "Total de parcelas",
      account_id: "Conta",
      to_account_id: "Conta destino",
      card_id: "Cartão",
      category_id: "Categoria",
      contact_id: "Contato",
    };
  const format = (key, value) =>
    value == null || value === ""
      ? "—"
      : ["amount", "opening", "credit_limit"].includes(key)
        ? money(value)
        : ["due_date", "paid_date"].includes(key)
          ? displayDate(value)
          : key === "kind"
            ? kindNames[value] || value
            : key.endsWith("_id")
              ? state[
                  {
                    account_id: "accounts",
                    to_account_id: "accounts",
                    card_id: "cards",
                    category_id: "categories",
                    contact_id: "contacts",
                  }[key]
                ].find((x) => String(x.id) === String(value))?.name ||
                "Cadastro #" + value
              : String(value);
  const title =
    after.description ||
    before.description ||
    after.name ||
    before.name ||
    "Registro #" + row.entity_id;
  const changes = Object.keys(labels)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map(
      (k) =>
        "<div>" +
        esc(labels[k]) +
        ": " +
        esc(format(k, before[k])) +
        " → " +
        esc(format(k, after[k])) +
        "</div>",
    )
    .join("");
  return (
    "<b>" +
    esc(title) +
    "</b>" +
    (row.action === "update" && changes
      ? '<details class="audit-details"><summary>Ver alterações</summary>' +
        changes +
        "</details>"
      : "")
  );
}
const icons = {
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  overview: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  entries: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  bills:
    '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4m8-4v4M4 10h16M8 14h3m-3 3h7"/>',
  cards:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  accounts: '<path d="m3 8 9-5 9 5H3zm2 3v7m7-7v7m7-7v7M3 21h18"/>',
  categories:
    '<path d="m3 3 8 0 10 10-8 8L3 11V3z"/><circle cx="7.5" cy="7.5" r="1"/>',
  contacts:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 5"/>',
  reports: '<path d="M4 21V3h12l4 4v14H4zm12-18v5h4M8 12h8M8 16h8"/>',
  audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  theme: '<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5z"/>',
};
const icon = (name) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>";
document
  .querySelectorAll("[data-icon]")
  .forEach((x) => (x.innerHTML = icon(x.dataset.icon)));
$("#theme").innerHTML = icon("theme");
const mobileNav = window.matchMedia("(max-width:760px)");
function syncNav() {
  const opened = document.body.classList.contains("nav-open");
  $("#sidebar").inert = mobileNav.matches && !opened;
  $(".main").inert = mobileNav.matches && opened;
}
mobileNav.addEventListener("change", () => closeNav());
function closeNav() {
  document.body.classList.remove("nav-open");
  $("#menu").setAttribute("aria-expanded", "false");
  syncNav();
}
$("#menu").onclick = () => {
  document.body.classList.add("nav-open");
  $("#menu").setAttribute("aria-expanded", "true");
  syncNav();
  $("#close-nav").focus();
};
$("#close-nav").onclick = $("#nav-backdrop").onclick = () => {
  closeNav();
  $("#menu").focus();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
    closeNav();
    $("#menu").focus();
  }
  if (
    e.key === "Tab" &&
    mobileNav.matches &&
    document.body.classList.contains("nav-open")
  ) {
    const buttons = [
        ...$("#sidebar").querySelectorAll("button:not(:disabled)"),
      ],
      first = buttons[0],
      last = buttons.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
function bindActions(root) {
  if (state.space.kind === "business") bindBusinessActions(root);
  root.querySelectorAll("[data-restore]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        const row = state.trashEntries.find(
          (x) => String(x.id) === button.dataset.restore,
        );
        try {
          await api(endpoint("entries/" + row.id + "/restore"), {
            method: "POST",
            body: JSON.stringify({ version: row.version }),
          });
          notify("Lançamento restaurado");
          await load();
        } catch (err) {
          notify(err.message);
          button.disabled = false;
        }
      }),
  );

  root.querySelectorAll("[data-edit-asset]").forEach(
    (x) =>
      (x.onclick = () => {
        const [type, id] = x.dataset.editAsset.split(":");
        openForm(
          type,
          state[type].find((r) => String(r.id) === id),
        );
      }),
  );
  root.querySelectorAll("[data-settle]").forEach(
    (x) =>
      (x.onclick = () => {
        const r = [
          ...state.entries,
          ...state.pendingEntries,
          ...state.paymentEntries,
        ].find((r) => String(r.id) === x.dataset.settle);
        if (r.document_id) return openLinkedDocument(r.document_id, true);
        openForm("entries", { ...r, paid_date: today() });
        $("#form [name=paid_date]").focus();
      }),
  );

  root
    .querySelectorAll("[data-create]")
    .forEach((x) => (x.onclick = () => openForm(x.dataset.create)));
  root.querySelectorAll("[data-go]").forEach(
    (x) =>
      (x.onclick = () => {
        if (x.dataset.go === "bills") {
          state.kind = "all";
          state.status = "all";
        }
        state.view = x.dataset.go;
        render();
      }),
  );
  root.querySelectorAll("[data-edit]").forEach(
    (x) =>
      (x.onclick = () => {
        const row = [
          ...state.entries,
          ...state.pendingEntries,
          ...state.paymentEntries,
        ].find((t) => String(t.id) === x.dataset.edit);
        if (row.document_id) return openLinkedDocument(row.document_id);
        openForm("entries", row);
      }),
  );
  root
    .querySelectorAll("[data-delete]")
    .forEach((x) => (x.onclick = () => remove("entries", x.dataset.delete)));
  root.querySelectorAll("[data-remove]").forEach(
    (x) =>
      (x.onclick = () => {
        const [type, id] = x.dataset.remove.split(":");
        remove(type, id);
      }),
  );
}
function changeMonth(delta) {
  const [year, month] = state.month.split("-").map(Number),
    date = new Date(year, month - 1 + delta, 1);
  state.month =
    date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  load();
}
function render() {
  if (!state.space || !state.summary) return;
  closeNav();
  document.body.classList.toggle("business", state.space.kind === "business");
  document
    .querySelectorAll(".business-only")
    .forEach((b) =>
      b.classList.toggle("hidden", state.space.kind !== "business"),
    );
  $("#contacts-label").textContent =
    state.space.kind === "business" ? "Cafeterias e fornecedores" : "Contatos";
  $("#add").textContent =
    state.space.kind === "business" &&
    ["overview", "sales", "purchases"].includes(state.view)
      ? state.view === "purchases"
        ? "+ Registrar compra"
        : "+ Nova venda"
      : state.view === "products"
        ? "+ Cadastrar item"
        : "+ Novo lançamento";
  const labels = {
      overview: "Visão geral",
      entries: "Lançamentos",
      bills: "A pagar e receber",
      cards: "Cartões",
      accounts: "Contas e caixas",
      categories: "Categorias",
      contacts: "Contatos",
      reports: "Prestação de contas",
      audit: "Histórico de ações",
      trash: "Lixeira",
      sales: "Vendas e comprovantes",
      purchases: "Compras de materiais",
      products: "Doces e materiais",
      "business-profile": "Dados da doceria",
    },
    descriptions = {
      overview: "Um olhar sobre as contas, os gastos e o que vem pela frente.",
      entries: "Cada entrada e saída, com os detalhes que você precisa.",
      bills: "Acompanhe o que ainda precisa ser pago ou recebido.",
      cards: "Limites, datas e compras dos seus cartões.",
      accounts: "O dinheiro disponível nos bancos e nos caixas.",
      categories: "Organize as receitas e despesas do seu jeito.",
      contacts: "Clientes, fornecedores e pessoas dos seus lançamentos.",
      reports: "Confira os números e compartilhe o demonstrativo.",
      trash: "Recupere lançamentos removidos sem perder o histórico.",
      audit: "Consulte os registros de alterações neste ambiente.",
      sales:
        "Doces, cafeterias e receitas, com um comprovante para cada venda.",
      purchases: "O que foi comprado, onde, quando e quanto custou.",
      products: "Cadastre doces para vender e materiais para comprar.",
      "business-profile":
        "Identificação que aparece nos novos comprovantes em PDF.",
    };
  $("#heading").textContent = labels[state.view];
  $("#view-description").textContent = descriptions[state.view];
  $("#context").textContent = state.space.name.toUpperCase() + " / FINANCEIRO";
  $("#spaces").innerHTML = state.spaces
    .map(
      (x) =>
        '<button data-space="' +
        x.id +
        '" aria-pressed="' +
        (x.id === state.space.id) +
        '" class="' +
        (x.id === state.space.id ? "active" : "") +
        '"><span class="space-dot" aria-hidden="true"></span>' +
        esc(x.name) +
        "</button>",
    )
    .join("");
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view);
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const selected = state.view;
  const main =
    selected === "sales"
      ? businessView("sale")
      : selected === "purchases"
        ? businessView("purchase")
        : selected === "products"
          ? productView()
          : selected === "business-profile"
            ? profileView()
            : selected === "overview"
              ? overview()
              : selected === "entries"
                ? entriesView()
                : selected === "bills"
                  ? entriesView(true)
                  : ["accounts", "cards", "categories", "contacts"].includes(
                        selected,
                      )
                    ? assets(selected)
                    : selected === "trash"
                      ? trashView()
                      : selected === "reports"
                        ? reports()
                        : section(
                            "Atividade recente",
                            state.audit.length
                              ? table(
                                  [
                                    "Ação",
                                    "Registro",
                                    "Detalhes",
                                    "Responsável",
                                    "Data",
                                  ],
                                  state.audit.map(
                                    (x) =>
                                      "<tr><td>" +
                                      esc(
                                        {
                                          create: "Criação",
                                          update: "Edição",
                                          delete: "Exclusão",
                                          restore: "Restauração",
                                        }[x.action] || x.action,
                                      ) +
                                      "</td><td>" +
                                      esc(
                                        {
                                          entries: "Lançamento",
                                          accounts: "Conta",
                                          cards: "Cartão",
                                          categories: "Categoria",
                                          contacts: "Contato",
                                          products: "Doce / material",
                                          business_documents: "Compra / venda",
                                          business_profiles: "Dados da doceria",
                                        }[x.entity] || x.entity,
                                      ) +
                                      " #" +
                                      x.entity_id +
                                      "</td><td>" +
                                      auditDetails(x) +
                                      "</td><td>" +
                                      esc(x.actor || "Registro anterior") +
                                      "</td><td>" +
                                      new Date(x.at).toLocaleString("pt-BR") +
                                      "</td></tr>",
                                  ),
                                )
                              : empty(
                                  "Nenhuma alteração registrada.",
                                  "As ações realizadas neste ambiente aparecerão aqui.",
                                ),
                          );
  $("#content").innerHTML =
    '<div class="period-bar"><span>Resumo mensal</span><div class="month-control"><button id="prev-month" aria-label="Mês anterior">‹</button><label for="month">Mês de referência</label><input type="month" id="month" value="' +
    state.month +
    '" required><button id="next-month" aria-label="Próximo mês">›</button></div></div>' +
    main;
  if (selected === "bills" || selected === "trash")
    $(".period-bar").innerHTML =
      "<span>" +
      (selected === "trash"
        ? "Lançamentos removidos"
        : "Pendências de todos os meses") +
      "</span>";
  if ($("#month"))
    $("#month").onchange = async (e) => {
      if (/^\d{4}-\d{2}$/.test(e.target.value)) {
        state.month = e.target.value;
        await load();
      }
    };
  if ($("#prev-month")) $("#prev-month").onclick = () => changeMonth(-1);
  if ($("#next-month")) $("#next-month").onclick = () => changeMonth(1);
  $("#csv")?.addEventListener("click", () => {
    location.href =
      endpoint("export.csv") + "?" + new URLSearchParams(period());
  });
  $("#csv-all")?.addEventListener("click", () => {
    location.href = endpoint("export.csv");
  });
  $("#csv-paid")?.addEventListener("click", () => {
    location.href =
      endpoint("export.csv") +
      "?" +
      new URLSearchParams({ ...period(), basis: "payment" });
  });
  $("#backup")?.addEventListener("click", () => {
    location.href = endpoint("backup.json");
  });
  $("#print")?.addEventListener("click", () => window.print());
  bindActions($("#content"));
  const updateEntries = () => {
    const bills = state.view === "bills";
    $("#entry-results").innerHTML = entryTable(bills);
    $("#entry-count").textContent =
      filteredEntries(bills).length + " lançamentos";
    bindActions($("#entry-results"));
  };
  for (const [id, key] of [
    ["search", "search"],
    ["kind-filter", "kind"],
    ["status-filter", "status"],
    ["sort-filter", "order"],
  ]) {
    const field = $("#" + id);
    if (field)
      field.addEventListener(id === "search" ? "input" : "change", (e) => {
        state[key] = e.target.value;
        updateEntries();
      });
  }
}
async function remove(type, id) {
  const record = (
    type === "entries"
      ? [...state.entries, ...state.pendingEntries, ...state.paymentEntries]
      : state[type]
  ).find((x) => String(x.id) === String(id));
  if (!record) return notify("Atualize a página para localizar o registro.");
  if (
    !confirm(
      type === "entries"
        ? "Mover este lançamento para a lixeira? Ele poderá ser restaurado depois."
        : "Excluir este cadastro? Esta ação não pode ser desfeita.",
    )
  )
    return;
  try {
    await api(endpoint(type + "/" + id), {
      method: "DELETE",
      body: JSON.stringify({ version: record.version }),
    });
    notify(
      type === "entries"
        ? "Lançamento movido para a lixeira"
        : "Cadastro excluído",
    );
    await load();
  } catch (err) {
    notify(err.message);
  }
}
function opts(type, selected) {
  return (
    '<option value="">Nenhum</option>' +
    state[type]
      .map(
        (x) =>
          '<option value="' +
          x.id +
          '" ' +
          (String(selected || "") === String(x.id) ? "selected" : "") +
          ">" +
          esc(x.name) +
          "</option>",
      )
      .join("")
  );
}
function field(
  label,
  name,
  type = "text",
  value = "",
  wide = false,
  extra = "",
) {
  const v = value == null ? "" : String(value);
  return (
    '<label class="' +
    (wide ? "wide" : "") +
    '">' +
    esc(label) +
    (type === "textarea"
      ? '<textarea name="' + name + '" rows="3">' + esc(v) + "</textarea>"
      : '<input name="' +
        name +
        '" type="' +
        type +
        '" value="' +
        esc(v) +
        '" ' +
        extra +
        "/>") +
    "</label>"
  );
}
function select(label, name, options, value) {
  return (
    "<label>" +
    esc(label) +
    '<select name="' +
    name +
    '">' +
    options
      .map(
        ([v, l]) =>
          '<option value="' +
          esc(v) +
          '" ' +
          (String(value ?? "") === String(v) ? "selected" : "") +
          ">" +
          esc(l) +
          "</option>",
      )
      .join("") +
    "</select></label>"
  );
}
function linked(label, name, type, value) {
  return (
    "<label>" +
    label +
    '<select name="' +
    name +
    '">' +
    opts(type, value) +
    "</select></label>"
  );
}
function openForm(type, record = null, documentKind = "sale") {
  state.formSpace = state.space.id;
  state.writeKey = crypto.randomUUID();
  state.lastWritePayload = null;
  state.mode = type;
  state.edit = record;
  $("#modal-subtitle").textContent = state.space.name;
  $("#modal-title").textContent =
    (record ? "Editar " : "Novo ") +
    {
      entries: "lançamento",
      accounts: "conta",
      cards: "cartão",
      categories: "categoria",
      contacts: "contato",
      products: "item",
      documents:
        record?.kind === "purchase" || documentKind === "purchase"
          ? "compra"
          : "venda",
      "business-profile": "dados da doceria",
      "document-payment": "pagamento / recebimento",
    }[type];
  $("#form-error").textContent = "";
  let html = "";
  if (type === "documents")
    html = documentFormHTML(record?.kind || documentKind, record || {});
  if (type === "document-payment") {
    $("#modal-title").textContent =
      record.kind === "sale" ? "Registrar recebimento" : "Registrar pagamento";
    html =
      '<p class="wide">' +
      esc(record.code) +
      " · " +
      esc(record.party_snapshot.name) +
      " · " +
      money(record.amount) +
      "</p>" +
      field(
        "Data do pagamento (vazio = reabrir pendência)",
        "paid_date",
        "date",
        localDate(record.paid_date) || today(),
        true,
        `max="${today()}"`,
      ) +
      (record.card_id
        ? '<p class="subtle wide">Compra vinculada ao cartão. O pagamento não gera uma segunda despesa.</p>'
        : linked(
            record.kind === "sale"
              ? "Conta que recebeu o valor"
              : "Conta de pagamento",
            "account_id",
            "accounts",
            record.account_id,
          ));
  }
  if (type === "business-profile")
    html =
      field(
        "Nome da doceria *",
        "name",
        "text",
        record.name,
        true,
        'required maxlength="150"',
      ) +
      field(
        "CPF/CNPJ",
        "document",
        "text",
        record.document,
        false,
        'maxlength="50"',
      ) +
      field(
        "Telefone",
        "phone",
        "text",
        record.phone,
        false,
        'maxlength="50"',
      ) +
      field(
        "Endereço",
        "address",
        "text",
        record.address,
        true,
        'maxlength="300"',
      );
  if (type === "products")
    html =
      field(
        "Nome do doce / material *",
        "name",
        "text",
        record?.name || "",
        true,
        'required maxlength="150"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["product", "Doce vendido"],
          ["material", "Material comprado"],
        ],
        record?.kind || "product",
      ) +
      select("Unidade", "unit", businessUnits, record?.unit || "un") +
      field(
        "Preço padrão (R$)",
        "default_price",
        "number",
        record?.default_price || "0",
        false,
        'min="0" step="0.01" max="999999999999.99"',
      );
  if (type === "entries") {
    const d = record || {};
    html =
      field(
        "Descrição *",
        "description",
        "text",
        d.description,
        "wide",
        'required maxlength="300"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["expense", "Despesa"],
          ["income", "Receita"],
          ["transfer", "Transferência"],
        ],
        d.kind || "expense",
      ) +
      field(
        "Valor (R$) *",
        "amount",
        "number",
        d.amount || "",
        "",
        'required min="0.01" max="999999999999.99" step="0.01"',
      ) +
      field(
        "Vencimento / competência *",
        "due_date",
        "date",
        localDate(d.due_date) || today(),
        false,
        'required min="1000-01-01" max="9999-12-31"',
      ) +
      field(
        "Data do pagamento (vazio = pendente)",
        "paid_date",
        "date",
        localDate(d.paid_date),
        false,
        `min="1000-01-01" max="${today()}"`,
      ) +
      linked(
        "Conta de origem / destino",
        "account_id",
        "accounts",
        d.account_id,
      ) +
      linked(
        "Conta destino (transferência)",
        "to_account_id",
        "accounts",
        d.to_account_id,
      ) +
      linked("Cartão de crédito", "card_id", "cards", d.card_id) +
      linked("Categoria", "category_id", "categories", d.category_id) +
      '<details class="form-section"><summary>Mais detalhes · contato, parcelas e observações</summary><div class="form-grid">' +
      linked("Cliente / fornecedor", "contact_id", "contacts", d.contact_id) +
      field("Centro de custo", "cost_center", "text", d.cost_center) +
      field(
        "Número da parcela",
        "installment_number",
        "number",
        d.installment_number,
        false,
        'min="1" max="360"',
      ) +
      field(
        "Total de parcelas",
        "installment_count",
        "number",
        d.installment_count,
        false,
        'min="1" max="360"',
      ) +
      field(
        "Observações / comprovante (referência)",
        "notes",
        "textarea",
        d.notes,
        true,
      ) +
      (record
        ? '<p class="subtle wide">A edição altera somente esta parcela.</p>'
        : '<label class="check-label wide"><input type="checkbox" name="generate_installments">Gerar todas as parcelas mensais · informe o valor de cada parcela, o número 1 e o total de parcelas.</label>') +
      "</div></details>";
  }
  if (type === "accounts")
    html =
      field(
        "Nome *",
        "name",
        "text",
        record?.name || "",
        false,
        'required maxlength="150"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["bank", "Banco"],
          ["cash", "Dinheiro"],
          ["savings", "Poupança"],
          ["investment", "Investimento"],
        ],
        record?.kind || "bank",
      ) +
      field(
        "Saldo inicial (R$)",
        "opening",
        "number",
        record?.opening ?? 0,
        false,
        'step="0.01"',
      );
  if (type === "cards")
    html =
      field(
        "Nome do cartão *",
        "name",
        "text",
        record?.name || "",
        false,
        'required maxlength="150"',
      ) +
      field(
        "Limite (R$)",
        "credit_limit",
        "number",
        record?.credit_limit ?? 0,
        false,
        'min="0" step="0.01"',
      ) +
      field(
        "Dia de fechamento",
        "closing_day",
        "number",
        record?.closing_day ?? 1,
        false,
        'min="1" max="31"',
      ) +
      field(
        "Dia de vencimento",
        "due_day",
        "number",
        record?.due_day ?? 10,
        false,
        'min="1" max="31"',
      );
  if (type === "categories")
    html =
      field(
        "Nome *",
        "name",
        "text",
        record?.name || "",
        false,
        'required maxlength="150"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["expense", "Despesa"],
          ["income", "Receita"],
        ],
        record?.kind || "expense",
      );
  if (type === "contacts")
    html =
      field(
        "Nome *",
        "name",
        "text",
        record?.name || "",
        false,
        'required maxlength="150"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["supplier", "Fornecedor"],
          [
            "customer",
            state.space.kind === "business" ? "Cafeteria / cliente" : "Cliente",
          ],
          ["other", "Outro"],
        ],
        record?.kind ||
          (state.space.kind === "business" ? "customer" : "other"),
      ) +
      field(
        "CPF/CNPJ (opcional)",
        "document",
        "text",
        record?.document || "",
        false,
        'maxlength="50"',
      ) +
      field(
        "Endereço (opcional)",
        "address",
        "text",
        record?.address || "",
        false,
        'maxlength="300"',
      ) +
      field("Observações", "notes", "textarea", record?.notes || "", true);
  $("#form-fields").innerHTML = html;
  $("#dialog").classList.toggle("document-dialog", type === "documents");
  if (type === "documents")
    setupDocumentForm(record?.kind || documentKind, record || {});
  if (type === "entries") {
    const kind = $("#form [name=kind]"),
      account = $("#form [name=account_id]"),
      card = $("#form [name=card_id]"),
      destination = $("#form [name=to_account_id]"),
      category = $("#form [name=category_id]");
    const updateKind = () => {
      const transfer = kind.value === "transfer",
        expense = kind.value === "expense",
        selected = category.value;
      destination.closest("label").classList.toggle("hidden", !transfer);
      destination.required = transfer;
      account.required = transfer;
      card.closest("label").classList.toggle("hidden", !expense);
      category.closest("label").classList.toggle("hidden", transfer);
      category.innerHTML =
        '<option value="">Nenhuma</option>' +
        state.categories
          .filter((c) => c.kind === kind.value)
          .map(
            (c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>",
          )
          .join("");
      category.value = selected;
      if (!expense) card.value = "";
      if (!transfer) destination.value = "";
      const generation = $("#form [name=generate_installments]");
      if (generation) {
        generation.disabled = transfer;
        if (transfer) generation.checked = false;
      }
    };
    kind.addEventListener("change", updateKind);
    updateKind();
    account.addEventListener("change", () => {
      if (account.value) card.value = "";
    });
    card.addEventListener("change", () => {
      if (card.value) account.value = "";
    });
  }
  $("#form-fields")
    .querySelectorAll("textarea")
    .forEach((x) => (x.maxLength = 1500));
  const cost = $("#form [name=cost_center]");
  if (cost) cost.maxLength = 100;
  $("#dialog").showModal();
}
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("[type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  const values =
    state.mode === "documents"
      ? documentFormValues(e.target)
      : Object.fromEntries(new FormData(e.target));
  for (const f of [
    "account_id",
    "to_account_id",
    "card_id",
    "category_id",
    "contact_id",
    "paid_date",
    "installment_number",
    "installment_count",
  ])
    if (f in values && !values[f]) values[f] = null;
  if (state.edit) values.version = state.edit.version;
  if ("generate_installments" in values)
    values.generate_installments = values.generate_installments === "on";
  const payload = JSON.stringify(values);
  if (state.lastWritePayload !== null && state.lastWritePayload !== payload)
    state.writeKey = crypto.randomUUID();
  state.lastWritePayload = payload;
  try {
    const path =
      "/api/s/" +
      state.formSpace +
      "/" +
      (state.mode === "document-payment"
        ? "documents/" + state.edit.id + "/payment"
        : state.mode) +
      (state.edit &&
      !["business-profile", "document-payment"].includes(state.mode)
        ? "/" + state.edit.id
        : "");
    const result = await api(path, {
      writeKey: state.writeKey,
      method:
        state.mode === "document-payment"
          ? "POST"
          : state.edit
            ? "PUT"
            : "POST",
      body: payload,
    });
    $("#dialog").close();
    notify(
      result.created_count > 1
        ? `${result.created_count} parcelas criadas`
        : "Salvo com sucesso",
    );
    await load();
  } catch (err) {
    $("#form-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
let securityVersion = 0;
function closeSecurity() {
  securityVersion++;
  $("#security-dialog").close();
  $("#password-form").reset();
  $("#session-list").replaceChildren();
  $("#security-error").textContent = "";
}
$("#close-security").onclick = closeSecurity;
$("#security-dialog").addEventListener("cancel", (e) => {
  if ($("#password-form button").disabled) e.preventDefault();
  else closeSecurity();
});
async function refreshSessions() {
  const version = ++securityVersion;
  const sessions = await api("/api/sessions");
  if (version !== securityVersion) return;
  $("#session-list").innerHTML = sessions
    .map(
      (s) =>
        '<div class="session-row"><b>' +
        (s.current ? "Este dispositivo" : "Outro dispositivo") +
        '</b><div class="subtle">' +
        esc(s.user_agent || "Dispositivo não identificado") +
        "</div><small>Último uso: " +
        new Date(s.last_seen).toLocaleString("pt-BR") +
        "</small></div>",
    )
    .join("");
  $("#revoke-sessions").disabled = !sessions.some((s) => !s.current);
}
$("#account-security").onclick = async () => {
  $("#security-error").textContent = "";
  $("#session-policy").textContent =
    `A sessão expira após ${state.sessionIdleHours} horas sem uso ou 7 dias após o login.`;
  $("#password-form").reset();
  $("#session-list").textContent = "Carregando acessos…";
  $("#revoke-sessions").disabled = true;
  $("#security-dialog").showModal();
  try {
    await refreshSessions();
  } catch (err) {
    $("#security-error").textContent = err.message;
  }
};
$("#revoke-sessions").onclick = async () => {
  const button = $("#revoke-sessions");
  if (button.disabled) return;
  button.disabled = true;
  try {
    await api("/api/sessions/revoke-others", { method: "POST", body: "{}" });
    notify("Outros acessos encerrados");
    await refreshSessions();
  } catch (err) {
    $("#security-error").textContent = err.message;
    button.disabled = false;
  }
};
$("#password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button[type=submit]");
  if (button.disabled) return;
  const values = Object.fromEntries(new FormData(e.target));
  if (values.new_password !== values.confirm_password) {
    $("#security-error").textContent =
      "A confirmação não corresponde à nova senha.";
    return;
  }
  button.disabled = true;
  $("#close-security").disabled = true;
  $("#security-error").textContent = "";
  try {
    const result = await api("/api/password", {
      method: "POST",
      body: JSON.stringify(values),
    });
    state.csrfToken = result.csrfToken;
    e.target.reset();
    notify("Senha atualizada. Outros acessos foram encerrados.");
    await refreshSessions();
  } catch (err) {
    $("#security-error").textContent = err.message;
  } finally {
    button.disabled = false;
    $("#close-security").disabled = false;
  }
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    showLogin();
    boot();
  }
});
const businessUnits = [
  ["un", "Unidade"],
  ["kg", "Quilo"],
  ["g", "Grama"],
  ["l", "Litro"],
  ["ml", "Mililitro"],
  ["pacote", "Pacote"],
  ["caixa", "Caixa"],
];
const docTotal = (rows) =>
  rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0) / 100;
function businessOverview() {
  const sales = state.documents.filter((r) => r.kind === "sale"),
    purchases = state.documents.filter((r) => r.kind === "purchase");
  return (
    '<section class="business-intro"><div><span class="eyebrow">ROTINA DA DOCERIA</span><h3>Da compra do ingrediente à entrega na cafeteria.</h3><p>Registre os itens uma vez. Receitas, despesas e comprovantes ficam conectados.</p></div><div class="button-row"><button class="primary" data-new-document="sale">+ Nova venda</button><button data-new-document="purchase">+ Registrar compra</button></div></section><div class="business-metrics">' +
    [
      [
        "Vendas realizadas",
        money(docTotal(sales)),
        `${sales.length} comprovantes no mês`,
      ],
      [
        "Materiais comprados",
        money(docTotal(purchases)),
        `${purchases.length} compras no mês`,
      ],
      [
        "Vendas a receber",
        money(docTotal(sales.filter((r) => !r.paid_date))),
        "Vendas deste mês em aberto",
      ],
    ]
      .map(
        ([label, value, hint]) =>
          `<div><small>${label}</small><strong>${value}</strong><span class="subtle">${hint}</span></div>`,
      )
      .join("") +
    "</div>"
  );
}
function documentStatus(d) {
  return d.paid_date
    ? `<span class="tag good">${d.kind === "sale" ? "Recebido" : "Pago"}</span>`
    : `<span class="tag ${localDate(d.due_date) < today() ? "warn" : ""}">${localDate(d.due_date) < today() ? "Atrasado" : d.kind === "sale" ? "A receber" : "A pagar"}</span>`;
}
function documentItemsTable(items) {
  return table(
    ["Item", "Quantidade", "Preço unitário", "Total"],
    items.map(
      (i) =>
        `<tr><td>${esc(i.name)}</td><td>${Number(i.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${esc(i.unit)}</td><td class="amount">${money(i.unit_price)}</td><td class="amount">${money(i.total)}</td></tr>`,
    ),
  );
}
function businessView(kind) {
  const rows = state.documents
    .filter((r) => r.kind === kind)
    .filter((r) => {
      const text = [
        r.code,
        r.party_snapshot.name,
        r.reference,
        ...r.items.map((i) => i.name),
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      return (
        text.includes(
          (state.documentSearch || "").toLocaleLowerCase("pt-BR"),
        ) &&
        (!state.documentParty || String(r.party_id) === state.documentParty) &&
        (state.documentStatus === "all" ||
          (state.documentStatus === "paid"
            ? !!r.paid_date
            : state.documentStatus === "overdue"
              ? !r.paid_date && localDate(r.due_date) < today()
              : !r.paid_date))
      );
    });
  const parties = state.contacts.filter(
    (p) => p.kind === (kind === "sale" ? "customer" : "supplier"),
  );
  const tools =
    '<div class="toolbar document-toolbar"><div class="filters"><input type="search" id="document-search" aria-label="Buscar documentos" placeholder="Buscar cafeteria, item ou número" value="' +
    esc(state.documentSearch || "") +
    '"><select id="document-party" aria-label="Filtrar cafeteria ou fornecedor"><option value="">' +
    (kind === "sale" ? "Todas as cafeterias" : "Todos os fornecedores") +
    "</option>" +
    parties
      .map(
        (p) =>
          `<option value="${p.id}" ${state.documentParty === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`,
      )
      .join("") +
    '</select><select id="document-status" aria-label="Filtrar pagamento">' +
    [
      ["all", "Todas as situações"],
      ["pending", kind === "sale" ? "A receber" : "A pagar"],
      ["paid", kind === "sale" ? "Recebidas" : "Pagas"],
      ["overdue", "Atrasadas"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${state.documentStatus === v ? "selected" : ""}>${l}</option>`,
      )
      .join("") +
    '</select></div><button class="primary" data-new-document="' +
    kind +
    '">+ ' +
    (kind === "sale" ? "Nova venda" : "Registrar compra") +
    "</button></div>";
  return (
    tools +
    '<div class="document-summary"><span>' +
    rows.length +
    " " +
    (kind === "sale" ? "vendas" : "compras") +
    " no filtro</span><strong>" +
    money(docTotal(rows)) +
    "</strong><span>" +
    money(docTotal(rows.filter((r) => !r.paid_date))) +
    " em aberto</span></div>" +
    (kind === "sale"
      ? '<p class="subtle document-note">PDF de controle comercial, não fiscal. Marcar como recebida atualiza o caixa; salvar a venda já registra a receita.</p>'
      : '<p class="subtle document-note">Cada compra registra uma despesa com fornecedor, data, quantidades e preços. Não lance a mesma compra novamente em Lançamentos.</p>') +
    (rows.length
      ? '<section class="document-list">' +
        rows
          .map(
            (d) =>
              `<article class="document-row"><div class="document-top"><div><span class="eyebrow">${esc(d.code)} · ${displayDate(d.issued_date)}</span><h3>${esc(d.party_snapshot.name)}</h3><p class="subtle">${d.items.length} ${d.items.length === 1 ? "item" : "itens"} · vencimento ${displayDate(d.due_date)}${d.reference ? " · " + esc(d.reference) : ""}</p></div><div class="document-value"><strong>${money(d.amount)}</strong>${documentStatus(d)}</div></div><details><summary>Ver itens e observações</summary>${documentItemsTable(d.items)}${d.notes ? '<p class="document-notes">' + esc(d.notes) + "</p>" : ""}</details><div class="document-actions"><button data-document-payment="${d.id}">${d.paid_date ? (kind === "sale" ? "Alterar recebimento" : "Alterar pagamento") : kind === "sale" ? "Registrar recebimento" : "Registrar pagamento"}</button><a class="button-link" href="${endpoint("documents/" + d.id + "/pdf")}">Baixar PDF</a><button data-document-edit="${d.id}">Editar</button><button data-document-delete="${d.id}" class="subtle">Mover para lixeira</button></div></article>`,
          )
          .join("") +
        "</section>"
      : empty(
          kind === "sale"
            ? "Nenhuma venda neste período."
            : "Nenhuma compra neste período.",
          "Escolha outro mês ou registre os itens usando o botão acima.",
        ))
  );
}
function productView() {
  const products = state.products.filter(
    (p) => state.productKind === "all" || p.kind === state.productKind,
  );
  return (
    '<div class="toolbar"><div class="filters"><select id="product-kind" aria-label="Tipo de item">' +
    [
      ["all", "Doces e materiais"],
      ["product", "Doces vendidos"],
      ["material", "Materiais comprados"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${state.productKind === v ? "selected" : ""}>${l}</option>`,
      )
      .join("") +
    '</select></div><button class="primary" data-create="products">+ Cadastrar item</button></div>' +
    section(
      "Catálogo da doceria",
      products.length
        ? table(
            ["Item", "Tipo", "Unidade", "Preço padrão", ""],
            products.map(
              (p) =>
                `<tr><td><b>${esc(p.name)}</b></td><td>${p.kind === "product" ? "Doce" : "Material"}</td><td>${esc(p.unit)}</td><td class="amount">${money(p.default_price)}</td><td><div class="actions"><button data-edit-asset="products:${p.id}">Editar</button><button data-remove="products:${p.id}">Excluir</button></div></td></tr>`,
            ),
          )
        : empty(
            "Cadastre seus doces e materiais.",
            "O preço padrão preenche a venda ou compra, e pode ser ajustado em cada documento.",
            "products",
            "Cadastrar primeiro item",
          ),
    )
  );
}
function businessReport() {
  const sales = state.documents.filter((d) => d.kind === "sale");
  const purchases = state.documents.filter((d) => d.kind === "purchase");
  const group = (rows, items = false) => {
    const result = new Map();
    for (const d of rows)
      for (const i of items ? d.items : [null]) {
        const key = items ? i.name + "|" + i.unit : String(d.party_id),
          label = items ? i.name : d.party_snapshot.name;
        const r = result.get(key) || {
          label,
          unit: i?.unit,
          total: 0,
          quantity: 0,
          pending: 0,
        };
        r.total += Math.round(Number(i?.total || d.amount) * 100);
        r.quantity += Number(i?.quantity || 1);
        if (!d.paid_date)
          r.pending += Math.round(Number(i?.total || d.amount) * 100);
        result.set(key, r);
      }
    return [...result.values()].sort((a, b) => b.total - a.total);
  };
  const partyRows = group(sales),
    sweetRows = group(sales, true),
    materialRows = group(purchases, true);
  return (
    '<section class="panel business-report"><div class="section-head"><div><span class="eyebrow">POR DATA DA VENDA / COMPRA</span><h3>Prestação de contas da doceria</h3></div><button id="documents-csv">Exportar itens (CSV)</button></div><p class="subtle">As tabelas abaixo detalham somente compras e vendas cadastradas com itens no mês selecionado. O demonstrativo financeiro reúne também as outras receitas e despesas.</p><div class="business-metrics"><div><small>Vendas do mês</small><strong>' +
    money(docTotal(sales)) +
    "</strong></div><div><small>Compras de materiais</small><strong>" +
    money(docTotal(purchases)) +
    "</strong></div><div><small>Vendas em aberto</small><strong>" +
    money(docTotal(sales.filter((d) => !d.paid_date))) +
    "</strong></div></div>" +
    section(
      "Vendas por cafeteria",
      partyRows.length
        ? table(
            ["Cafeteria", "Vendas", "Valor", "A receber"],
            partyRows.map(
              (r) =>
                `<tr><td>${esc(r.label)}</td><td>${r.quantity}</td><td class="amount">${money(r.total / 100)}</td><td class="amount">${money(r.pending / 100)}</td></tr>`,
            ),
          )
        : empty(
            "Sem vendas no mês.",
            "Cadastre uma venda para acompanhar as cafeterias.",
          ),
    ) +
    section(
      "Doces vendidos",
      sweetRows.length
        ? table(
            ["Doce", "Quantidade", "Total vendido"],
            sweetRows.map(
              (r) =>
                `<tr><td>${esc(r.label)}</td><td>${r.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${esc(r.unit)}</td><td class="amount">${money(r.total / 100)}</td></tr>`,
            ),
          )
        : empty("Sem itens vendidos.", "Os doces das vendas aparecerão aqui."),
    ) +
    section(
      "Materiais comprados",
      materialRows.length
        ? table(
            ["Material", "Quantidade", "Total gasto"],
            materialRows.map(
              (r) =>
                `<tr><td>${esc(r.label)}</td><td>${r.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${esc(r.unit)}</td><td class="amount">${money(r.total / 100)}</td></tr>`,
            ),
          )
        : empty(
            "Sem materiais comprados.",
            "Os itens das compras aparecerão aqui.",
          ),
    ) +
    "</section>"
  );
}
function profileView() {
  const p = state.businessProfile;
  return section(
    "Dados nos novos comprovantes",
    '<p class="subtle">Preencha os dados reais da doceria para identificar os PDFs. Documentos já salvos mantêm os dados da emissão.</p>' +
      simpleLine("Nome", esc(p.name)) +
      simpleLine("CPF/CNPJ", esc(p.document || "Não informado")) +
      simpleLine("Endereço", esc(p.address || "Não informado")) +
      simpleLine("Telefone", esc(p.phone || "Não informado")) +
      '<div class="button-row"><button data-edit-profile>Editar dados da doceria</button></div>',
  );
}
function documentFormHTML(kind, d = {}) {
  const parties = state.contacts.filter(
    (p) => p.kind === (kind === "sale" ? "customer" : "supplier"),
  );
  const products = state.products.filter(
    (p) => p.kind === (kind === "sale" ? "product" : "material"),
  );
  return (
    (!parties.length || !products.length
      ? '<div class="guide wide">Antes de registrar, cadastre ' +
        (!parties.length
          ? kind === "sale"
            ? "a cafeteria em Cafeterias e fornecedores"
            : "o local da compra em Cafeterias e fornecedores"
          : "") +
        (!parties.length && !products.length ? " e " : "") +
        (!products.length
          ? (kind === "sale" ? "os doces" : "os materiais") +
            " em Doces e materiais"
          : "") +
        ".</div>"
      : "") +
    '<input type="hidden" name="kind" value="' +
    kind +
    '">' +
    select(
      kind === "sale"
        ? "Cafeteria / cliente *"
        : "Fornecedor / local da compra *",
      "party_id",
      [["", "Selecione"], ...parties.map((p) => [p.id, p.name])],
      d.party_id,
    ) +
    field(
      "Data da " + (kind === "sale" ? "venda" : "compra") + " *",
      "issued_date",
      "date",
      localDate(d.issued_date) || today(),
      false,
      `required max="${today()}"`,
    ) +
    field(
      "Vencimento *",
      "due_date",
      "date",
      localDate(d.due_date) || today(),
      false,
      "required",
    ) +
    field(
      kind === "sale"
        ? "Recebida em (vazio = a receber)"
        : "Paga em (vazio = a pagar)",
      "paid_date",
      "date",
      localDate(d.paid_date),
      false,
      `max="${today()}"`,
    ) +
    linked(
      kind === "sale" ? "Conta de recebimento" : "Conta de pagamento",
      "account_id",
      "accounts",
      d.account_id,
    ) +
    (kind === "purchase"
      ? linked("Cartão (opcional)", "card_id", "cards", d.card_id)
      : "") +
    select(
      "Categoria",
      "category_id",
      [
        ["", "Categoria padrão"],
        ...state.categories
          .filter((c) => c.kind === (kind === "sale" ? "income" : "expense"))
          .map((c) => [c.id, c.name]),
      ],
      d.category_id,
    ) +
    field(
      "Referência (pedido / nota do fornecedor)",
      "reference",
      "text",
      d.reference || "",
      false,
      'maxlength="150"',
    ) +
    '<section class="line-editor wide"><div class="section-head"><h3>' +
    (kind === "sale" ? "Doces vendidos" : "Materiais comprados") +
    '</h3><button type="button" id="add-document-item">+ Adicionar item</button></div><div id="document-items"></div><div class="document-total"><span>Total calculado</span><strong id="document-total">R$ 0,00</strong></div><p class="subtle">' +
    (kind === "sale"
      ? "Ao salvar, o total será registrado uma única vez como receita."
      : "Ao salvar, o total será registrado uma única vez como despesa.") +
    "</p></section>" +
    field("Observações", "notes", "textarea", d.notes || "", true)
  );
}
function setupDocumentForm(kind, record = {}) {
  const root = $("#document-items");
  const update = () => {
    let total = 0n,
      invalid = false;
    for (const line of root.children) {
      const q = line.querySelector("[data-quantity]").value,
        p = line.querySelector("[data-unit-price]").value;
      let cents = 0n;
      if (/^\d{1,9}(\.\d{1,3})?$/.test(q) && /^\d{1,12}(\.\d{1,2})?$/.test(p)) {
        const [a, b = ""] = q.split("."),
          [c, d = ""] = p.split(".");
        cents =
          ((BigInt(a) * 1000n + BigInt(b.padEnd(3, "0"))) *
            (BigInt(c) * 100n + BigInt(d.padEnd(2, "0"))) +
            500n) /
          1000n;
      } else invalid = true;
      total += cents;
      line.querySelector("[data-line-total]").textContent = money(
        Number(cents) / 100,
      );
    }
    $("#document-total").textContent = invalid
      ? "Preencha quantidades e preços"
      : money(Number(total) / 100);
  };
  const add = (item = {}) => {
    if (root.children.length >= 100)
      return notify("Limite de 100 itens por documento.");
    const options = state.products.filter(
      (p) => p.kind === (kind === "sale" ? "product" : "material"),
    );
    if (
      item.product_id &&
      !options.some((p) => String(p.id) === String(item.product_id))
    )
      options.push({
        id: item.product_id,
        name: item.name,
        unit: item.unit,
        default_price: item.unit_price,
      });
    const node = el("div", { class: "document-item" });
    node.innerHTML =
      '<label>Item *<select data-product required><option value="">Selecione</option>' +
      options
        .map(
          (p) =>
            `<option value="${p.id}" ${String(p.id) === String(item.product_id) ? "selected" : ""}>${esc(p.name)}</option>`,
        )
        .join("") +
      '</select></label><label>Quantidade *<input data-quantity type="number" step="0.001" min="0.001" max="999999999.999" required value="' +
      esc(item.quantity || "1") +
      '"></label><span data-line-unit class="line-unit">' +
      esc(item.unit || "") +
      '</span><label>Preço unitário (R$) *<input data-unit-price type="number" step="0.01" min="0.01" max="999999999999.99" required value="' +
      esc(item.unit_price || "") +
      '"></label><div class="line-subtotal"><small>Subtotal</small><strong data-line-total></strong></div><button type="button" class="remove-line" aria-label="Remover item">×</button>';
    const sel = node.querySelector("[data-product]"),
      qty = node.querySelector("[data-quantity]");
    const unit = () => {
      const p = options.find((p) => String(p.id) === sel.value);
      node.querySelector("[data-line-unit]").textContent = p?.unit || "";
      qty.step = p?.unit === "un" ? "1" : "0.001";
      qty.min = p?.unit === "un" ? "1" : "0.001";
    };
    sel.onchange = () => {
      const p = options.find((p) => String(p.id) === sel.value);
      node.querySelector("[data-unit-price]").value =
        Number(p?.default_price) > 0 ? p.default_price : "";
      unit();
      update();
    };
    node.querySelector(".remove-line").onclick = () => {
      node.remove();
      if (!root.children.length) add();
      update();
    };
    node.oninput = update;
    root.append(node);
    unit();
    update();
    return node;
  };
  for (const item of record.items?.length ? record.items : [{}]) add(item);
  $("#add-document-item").onclick = () =>
    add()?.querySelector("select").focus();
  $("#form [name=party_id]").required = true;
  const account = $("#form [name=account_id]"),
    card = $("#form [name=card_id]");
  if (card) {
    account.onchange = () => {
      if (account.value) card.value = "";
    };
    card.onchange = () => {
      if (card.value) account.value = "";
    };
  }
}
function documentFormValues(form) {
  const f = new FormData(form),
    body = {};
  for (const key of [
    "kind",
    "party_id",
    "issued_date",
    "due_date",
    "paid_date",
    "account_id",
    "card_id",
    "category_id",
    "reference",
    "notes",
  ])
    body[key] = f.get(key) || null;
  body.items = [...$("#document-items").children].map((n) => ({
    product_id: n.querySelector("[data-product]").value,
    quantity: n.querySelector("[data-quantity]").value,
    unit_price: n.querySelector("[data-unit-price]").value,
  }));
  return body;
}
async function openLinkedDocument(id, payment = false) {
  const space = state.space.id;
  try {
    const d = await api(endpoint("documents/" + id));
    if (!state.space || state.space.id !== space) return;
    openForm(payment ? "document-payment" : "documents", d);
  } catch (err) {
    notify(err.message);
  }
}
function bindBusinessActions(root) {
  root
    .querySelectorAll("[data-new-document]")
    .forEach(
      (b) =>
        (b.onclick = () => openForm("documents", null, b.dataset.newDocument)),
    );
  root
    .querySelectorAll("[data-document-edit]")
    .forEach(
      (b) => (b.onclick = () => openLinkedDocument(b.dataset.documentEdit)),
    );
  root
    .querySelectorAll("[data-document-payment]")
    .forEach(
      (b) =>
        (b.onclick = () => openLinkedDocument(b.dataset.documentPayment, true)),
    );
  root.querySelectorAll("[data-document-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        const d = state.documents.find(
          (d) => String(d.id) === b.dataset.documentDelete,
        );
        if (
          !confirm(
            "Mover este documento e o lançamento financeiro para a lixeira?",
          )
        )
          return;
        b.disabled = true;
        try {
          await api(endpoint("entries/" + d.entry_id), {
            method: "DELETE",
            body: JSON.stringify({ version: d.version }),
          });
          notify("Documento movido para a lixeira");
          await load();
        } catch (err) {
          notify(err.message);
          b.disabled = false;
        }
      }),
  );
  root
    .querySelector("[data-edit-profile]")
    ?.addEventListener("click", () =>
      openForm("business-profile", state.businessProfile),
    );
  const focusRender = (id, key, event) => {
    const input = root.querySelector("#" + id);
    if (input)
      input.addEventListener(event, () => {
        const pos = input.selectionStart;
        state[key] = input.value;
        render();
        const next = $("#" + id);
        next.focus();
        if (event === "input") next.setSelectionRange(pos, pos);
      });
  };
  focusRender("document-search", "documentSearch", "input");
  focusRender("document-party", "documentParty", "change");
  focusRender("document-status", "documentStatus", "change");
  focusRender("product-kind", "productKind", "change");
  $("#documents-csv")?.addEventListener("click", () => {
    location.href =
      endpoint("documents.csv") + "?" + new URLSearchParams(period());
  });
}

boot();

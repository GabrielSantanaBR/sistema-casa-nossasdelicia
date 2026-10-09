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
  today = () =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
const displayDate = (d) =>
  d ? localDate(d).split("-").reverse().join("/") : "—";
const state = {
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
  audit: [],
  edit: null,
  mode: "entries",
  month: today().slice(0, 7),
  search: "",
  kind: "all",
  status: "all",
  dark: localStorage.getItem("theme") === "dark",
};
const endpoint = (p = "") => "/api/s/" + state.space.id + "/" + p;
async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
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
  } finally {
    showLogin();
  }
};
$("#theme").onclick = () => {
  state.dark = !state.dark;
  localStorage.setItem("theme", state.dark ? "dark" : "light");
  document.body.classList.toggle("dark", state.dark);
};
$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b && !$("#content").hasAttribute("aria-busy")) {
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
    await load();
  }
});
$("#add").onclick = () => openForm("entries");
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
async function load() {
  const version = ++loadVersion;
  const base = endpoint();
  $("#content").innerHTML =
    '<div class="loading" role="status">Carregando suas contas…</div>';
  $("#content").setAttribute("aria-busy", "true");
  $("#add").disabled = true;
  document.querySelectorAll("#nav button").forEach(b => b.disabled = true);
  try {
    const [summary, entries, accounts, cards, categories, contacts, audit] =
      await Promise.all([
        api(base + "summary?" + new URLSearchParams(period())),
        api(base + "entries?" + new URLSearchParams(period())),
        api(base + "accounts"),
        api(base + "cards"),
        api(base + "categories"),
        api(base + "contacts"),
        api(base + "audit"),
      ]);
    if (version !== loadVersion) return;
    Object.assign(state, {
      summary,
      entries,
      accounts,
      cards,
      categories,
      contacts,
      audit,
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
      document.querySelectorAll("#nav button").forEach(b => b.disabled = false);
    }
  }
}
const sum = (kind) =>
  Number(state.summary?.totals?.find((x) => x.kind === kind)?.total || 0);
function table(head, rows) {
  return (
    '<div class="table-scroll"><table class="data-table"><thead><tr>' +
    head.map((x) => '<th'+(x.includes('col-date')?' class="col-date"':'')+'>'+x+'</th>').join("") +
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
    '</td><td><div class="actions"><button data-edit="' +
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
    pending = state.entries.filter(
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
    '<section class="balance-band" aria-label="Resumo do mês"><div class="balance-main"><small>Resultado previsto do mês</small><strong>' +
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
    '</section><div class="panel-stack"><section class="panel"><div class="section-head"><h3>A pagar e receber</h3><button class="text-button" data-go="bills">Ver →</button></div><div class="attention"><div><span class="muted">Pendentes no mês</span><div class="subtle">' +
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
      : '<p class="subtle">Nenhuma conta pendente neste mês.</p>') +
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
    "</section></div>"
  );
}
function filteredEntries(bills = false) {
  return state.entries.filter(
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
        "Confira o mês e os filtros ou registre uma movimentação.",
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
              '</div><div class="actions"><button data-remove="' +
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
    paidInc = state.entries
      .filter((x) => x.kind === "income" && x.paid_date)
      .reduce((a, x) => a + Number(x.amount), 0),
    paidExp = state.entries
      .filter((x) => x.kind === "expense" && x.paid_date)
      .reduce((a, x) => a + Number(x.amount), 0);
  return (
    '<div class="button-row"><button class="primary" id="csv">↓ Exportar prestação de contas (CSV)</button><button id="print">Imprimir esta página</button></div><div class="guide">O demonstrativo usa os lançamentos do mês selecionado. A exportação CSV contém o histórico completo do ambiente atual. Compras no cartão devem ser lançadas uma única vez para não duplicar despesas.</div><div class="panels">' +
    section(
      "Demonstrativo do período",
      simpleLine("Receitas previstas", money(inc)) +
        simpleLine("Despesas previstas", money(exp)) +
        simpleLine(
          "Resultado previsto",
          "<strong>" + money(inc - exp) + "</strong>",
        ) +
        simpleLine("Receitas recebidas", money(paidInc)) +
        simpleLine("Despesas liquidadas", money(paidExp)) +
        simpleLine("Resultado liquidado", money(paidInc - paidExp)),
    ) +
    section(
      "Pendências e exposição",
      simpleLine(
        "Despesas em aberto",
        money(
          state.entries
            .filter((x) => x.kind === "expense" && !x.paid_date)
            .reduce((a, x) => a + Number(x.amount), 0),
        ),
      ) +
        simpleLine(
          "Receitas a receber",
          money(
            state.entries
              .filter((x) => x.kind === "income" && !x.paid_date)
              .reduce((a, x) => a + Number(x.amount), 0),
          ),
        ) +
        simpleLine(
          "Valores atrasados (histórico)",
          money(state.summary.overdue.amount),
        ),
    ) +
    "</div>" +
    section(
      "Detalhamento para prestação de contas",
      table(
        ["Descrição", "Vencimento", "Tipo", "Valor", "Situação", ""],
        state.entries.map(entryRow),
      ),
    )
  );
}
const icons = {
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
function closeNav() {
  document.body.classList.remove("nav-open");
  $("#menu").setAttribute("aria-expanded", "false");
}
$("#menu").onclick = () => {
  document.body.classList.add("nav-open");
  $("#menu").setAttribute("aria-expanded", "true");
  $("#close-nav").focus();
};
$("#close-nav").onclick = $("#nav-backdrop").onclick = () => {
  closeNav();
  $("#menu").focus();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNav();
});
function bindActions(root) {
  root
    .querySelectorAll("[data-create]")
    .forEach((x) => (x.onclick = () => openForm(x.dataset.create)));
  root.querySelectorAll("[data-go]").forEach(
    (x) =>
      (x.onclick = () => {
        state.view = x.dataset.go;
        render();
      }),
  );
  root.querySelectorAll("[data-edit]").forEach(
    (x) =>
      (x.onclick = () =>
        openForm(
          "entries",
          state.entries.find((t) => String(t.id) === x.dataset.edit),
        )),
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
      audit: "Consulte os registros de alterações neste ambiente.",
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
    selected === "overview"
      ? overview()
      : selected === "entries"
        ? entriesView()
        : selected === "bills"
          ? entriesView(true)
          : ["accounts", "cards", "categories", "contacts"].includes(selected)
            ? assets(selected)
            : selected === "reports"
              ? reports()
              : section(
                  "Atividade recente",
                  state.audit.length
                    ? table(
                        ["Ação", "Registro", "Data"],
                        state.audit.map(
                          (x) =>
                            "<tr><td>" +
                            esc(
                              {
                                create: "Criação",
                                update: "Edição",
                                delete: "Exclusão",
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
                              }[x.entity] || x.entity,
                            ) +
                            " #" +
                            x.entity_id +
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
  $("#month").onchange = async (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) {
      state.month = e.target.value;
      await load();
    }
  };
  $("#prev-month").onclick = () => changeMonth(-1);
  $("#next-month").onclick = () => changeMonth(1);
  $("#csv")?.addEventListener("click", () => {
    location.href = endpoint("export.csv");
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
  if (!confirm("Excluir este registro? A ação não pode ser desfeita.")) return;
  try {
    await api(endpoint(type + "/" + id), { method: "DELETE" });
    notify("Registro excluído");
    await load();
  } catch (e) {
    notify(e.message);
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
function openForm(type, record = null) {
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
    }[type];
  $("#form-error").textContent = "";
  let html = "";
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
        'required min="0.01" step="0.01"',
      ) +
      field(
        "Vencimento / competência *",
        "due_date",
        "date",
        localDate(d.due_date) || today(),
        false,
        "required",
      ) +
      field(
        "Data do pagamento (vazio = pendente)",
        "paid_date",
        "date",
        localDate(d.paid_date),
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
      "</div></details>";
  }
  if (type === "accounts")
    html =
      field("Nome *", "name", "text", "", false, "required") +
      select(
        "Tipo",
        "kind",
        [
          ["bank", "Banco"],
          ["cash", "Dinheiro"],
          ["savings", "Poupança"],
          ["investment", "Investimento"],
        ],
        "bank",
      ) +
      field("Saldo inicial (R$)", "opening", "number", 0, false, 'step="0.01"');
  if (type === "cards")
    html =
      field("Nome do cartão *", "name", "text", "", false, "required") +
      field(
        "Limite (R$)",
        "credit_limit",
        "number",
        0,
        false,
        'min="0" step="0.01"',
      ) +
      field(
        "Dia de fechamento",
        "closing_day",
        "number",
        1,
        false,
        'min="1" max="31"',
      ) +
      field(
        "Dia de vencimento",
        "due_day",
        "number",
        10,
        false,
        'min="1" max="31"',
      );
  if (type === "categories")
    html =
      field("Nome *", "name", "text", "", false, "required") +
      select(
        "Tipo",
        "kind",
        [
          ["expense", "Despesa"],
          ["income", "Receita"],
        ],
        "expense",
      );
  if (type === "contacts")
    html =
      field("Nome *", "name", "text", "", false, "required") +
      select(
        "Tipo",
        "kind",
        [
          ["supplier", "Fornecedor"],
          ["customer", "Cliente"],
          ["other", "Outro"],
        ],
        "other",
      ) +
      field("Observações", "notes", "textarea", "", true);
  $("#form-fields").innerHTML = html;
  if (type === "entries") {
    const kind = $('#form [name=kind]'), account = $('#form [name=account_id]'), card = $('#form [name=card_id]'), destination = $('#form [name=to_account_id]');
    const updateKind = () => { const transfer = kind.value === 'transfer'; destination.closest('label').classList.toggle('hidden', !transfer); destination.required = transfer; card.closest('label').classList.toggle('hidden', transfer); if (transfer) card.value = ''; else destination.value = ''; };
    kind.addEventListener('change', updateKind); updateKind();
    account.addEventListener('change', () => { if(account.value) card.value = ''; });
    card.addEventListener('change', () => { if(card.value) account.value = ''; });
  }
  $("#dialog").showModal();
}
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  const values = Object.fromEntries(new FormData(e.target));
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
  try {
    const path = endpoint(state.mode + (state.edit ? "/" + state.edit.id : ""));
    await api(path, {
      method: state.edit ? "PUT" : "POST",
      body: JSON.stringify(values),
    });
    $("#dialog").close();
    notify("Salvo com sucesso");
    await load();
  } catch (err) {
    $("#form-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
boot();

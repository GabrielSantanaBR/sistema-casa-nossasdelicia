import express from "express";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { initialize } from "./database.js";
import {
  error,
  hash,
  passwordHash,
  safeText,
  validDate,
  todayBR,
  moneyValue,
  validId,
  monthDate,
  csvCell,
} from "./finance.js";

const run = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const cookieToken = (req) =>
  (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("fin_sid="))
    ?.slice(8) || "";
const csrf = (token) => hash(token + ":csrf");
const columns = [
  "description",
  "kind",
  "amount",
  "due_date",
  "paid_date",
  "account_id",
  "to_account_id",
  "card_id",
  "category_id",
  "contact_id",
  "cost_center",
  "notes",
  "installment_number",
  "installment_count",
  "installment_group",
];
const catalog = {
  accounts: ["name", "kind", "opening"],
  cards: ["name", "credit_limit", "closing_day", "due_day"],
  categories: ["name", "kind"],
  contacts: ["name", "kind", "notes"],
};
const catalogKinds = {
  accounts: ["bank", "cash", "savings", "investment"],
  categories: ["expense", "income"],
  contacts: ["supplier", "customer", "other"],
};
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const audit = (db, req, action, entity, id) =>
  db.query(
    "INSERT INTO audit(space_id,user_id,action,entity,entity_id) VALUES($1,$2,$3,$4,$5)",
    [req.sid, req.user.id, action, entity, id],
  );
function period(req) {
  const from = req.query.from ?? todayBR().slice(0, 7) + "-01";
  if (!validDate(from)) throw error("Período inválido");
  const [year, month] = from.split("-").map(Number);
  const end =
    req.query.to ??
    from.slice(0, 7) +
      "-" +
      String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0");
  if (!validDate(end) || from > end) throw error("Período inválido");
  return { from, to: end };
}
function catalogValues(table, body) {
  const result = { name: safeText(body.name, 150, "Nome", true) };
  if (catalogKinds[table]) {
    if (!catalogKinds[table].includes(body.kind))
      throw error("Tipo de cadastro inválido");
    result.kind = body.kind;
  }
  if (table === "accounts")
    result.opening = moneyValue(body.opening ?? 0, { signed: true });
  if (table === "cards") {
    result.credit_limit = moneyValue(body.credit_limit ?? 0);
    for (const key of ["closing_day", "due_day"]) {
      const day = Number(body[key]);
      if (!Number.isInteger(day) || day < 1 || day > 31)
        throw error("Informe dias entre 1 e 31");
      result[key] = day;
    }
  }
  if (table === "contacts")
    result.notes = safeText(body.notes, 1500, "Observações");
  return catalog[table].map((key) => result[key]);
}
async function entryValues(db, req) {
  const body = req.body;
  const value = {
    description: safeText(body.description, 300, "Descrição", true),
    kind: body.kind,
    amount: moneyValue(body.amount, { positive: true }),
    due_date: body.due_date,
    paid_date: body.paid_date || null,
    cost_center: safeText(body.cost_center, 100, "Centro de custo"),
    notes: safeText(body.notes, 1500, "Observações"),
  };
  if (
    !["income", "expense", "transfer"].includes(value.kind) ||
    !validDate(value.due_date) ||
    (value.paid_date && !validDate(value.paid_date))
  )
    throw error("Verifique o tipo e as datas do lançamento");
  if (value.paid_date && value.paid_date > todayBR())
    throw error("A data de pagamento não pode estar no futuro");
  for (const [field, table] of [
    ["account_id", "accounts"],
    ["to_account_id", "accounts"],
    ["card_id", "cards"],
    ["category_id", "categories"],
    ["contact_id", "contacts"],
  ]) {
    const id = body[field];
    value[field] = null;
    if (id == null || id === "") continue;
    if (!validId(id)) throw error("Cadastro vinculado inválido");
    const linked = (
      await db.query(
        `SELECT id${table === "categories" ? ",kind" : ""} FROM ${table} WHERE id=$1 AND space_id=$2`,
        [id, req.sid],
      )
    ).rows[0];
    if (!linked) throw error("Cadastro não pertence a este ambiente");
    if (
      table === "categories" &&
      value.kind !== "transfer" &&
      linked.kind !== value.kind
    )
      throw error("Selecione uma categoria do mesmo tipo do lançamento");
    value[field] = String(id);
  }
  if (value.kind === "transfer") {
    if (
      !value.account_id ||
      !value.to_account_id ||
      value.account_id === value.to_account_id ||
      value.card_id
    )
      throw error(
        "Transferência exige duas contas diferentes e não permite cartão",
      );
    value.category_id = null;
    value.contact_id = null;
  } else value.to_account_id = null;
  if (value.account_id && value.card_id)
    throw error("Selecione conta ou cartão, não ambos");
  if (value.card_id && value.kind !== "expense")
    throw error("Use uma conta para registrar receitas");
  for (const field of ["installment_number", "installment_count"]) {
    const number =
      body[field] == null || body[field] === "" ? null : Number(body[field]);
    if (
      number !== null &&
      (!Number.isInteger(number) || number < 1 || number > 360)
    )
      throw error("Parcelas devem estar entre 1 e 360");
    value[field] = number;
  }
  if (
    (value.installment_number === null) !==
      (value.installment_count === null) ||
    (value.installment_number &&
      value.installment_number > value.installment_count)
  )
    throw error("Informe o número e o total de parcelas corretamente");
  value.installment_group = null;
  return value;
}

export function createApp({
  db,
  production = false,
  publicOrigin = "",
  trustProxy = production ? 1 : false,
  loginLimit = 10,
  apiLimit = 600,
  logger = console,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use((req, res, next) => {
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.vary("Cookie");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("sec-fetch-site") === "cross-site")
        return next(error("Origem não permitida", 403));
      const origin = req.get("origin");
      const expected =
        publicOrigin || `${production ? "https" : "http"}://${req.get("host")}`;
      if (origin && origin !== expected)
        return next(error("Origem não permitida", 403));
      if (!req.is("application/json"))
        return next(error("Envie os dados como JSON", 415));
    }
    next();
  });
  app.use(express.json({ limit: "80kb", strict: true }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 900000,
      limit: apiLimit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Muitas solicitações. Aguarde alguns minutos." },
    }),
  );
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 900000,
      limit: loginLimit,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Muitas tentativas de acesso. Aguarde 15 minutos." },
    }),
    run(async (req, res) => {
      const email = safeText(req.body.email, 255, "E-mail", true).toLowerCase();
      if (
        typeof req.body.password !== "string" ||
        req.body.password.length > 500
      )
        throw error("Credenciais inválidas", 401);
      const user = (
        await db.query("SELECT * FROM users WHERE email=$1", [email])
      ).rows[0];
      const attempt = await passwordHash(
        req.body.password,
        user?.salt || "invalid-user-fixed-salt",
      );
      if (
        !user ||
        !crypto.timingSafeEqual(
          Buffer.from(attempt, "hex"),
          Buffer.from(user.pass, "hex"),
        )
      )
        throw error("Credenciais inválidas", 401);
      const token = crypto.randomBytes(32).toString("hex");
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM sessions WHERE expires<NOW()");
        await client.query(
          "INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,NOW()+INTERVAL '7 days')",
          [hash(token), user.id],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      res
        .cookie("fin_sid", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: production,
          maxAge: 604800000,
          path: "/",
        })
        .json({ ok: true });
    }),
  );
  app.use(
    "/api",
    run(async (req, res, next) => {
      const token = cookieToken(req);
      if (!/^[a-f0-9]{64}$/.test(token)) throw error("Faça login", 401);
      const user = (
        await db.query(
          "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>NOW()",
          [hash(token)],
        )
      ).rows[0];
      if (!user) throw error("Sessão expirada", 401);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const supplied = req.get("x-csrf-token") || "",
          expected = csrf(token);
        if (
          !/^[a-f0-9]{64}$/.test(supplied) ||
          !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        )
          throw error(
            "Sessão desatualizada. Atualize a página e tente novamente.",
            403,
          );
      }
      req.user = user;
      req.csrf = csrf(token);
      next();
    }),
  );
  app.get(
    "/api/me",
    run(async (req, res) =>
      res.json({
        user: req.user,
        csrfToken: req.csrf,
        spaces: (
          await db.query(
            "SELECT s.* FROM spaces s JOIN access a ON a.space_id=s.id WHERE a.user_id=$1 ORDER BY s.id",
            [req.user.id],
          )
        ).rows,
      }),
    ),
  );
  app.post(
    "/api/logout",
    run(async (req, res) => {
      await db.query("DELETE FROM sessions WHERE token=$1", [
        hash(cookieToken(req)),
      ]);
      res
        .clearCookie("fin_sid", {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
          secure: production,
        })
        .json({ ok: true });
    }),
  );
  app.use(
    "/api/s/:sid",
    run(async (req, res, next) => {
      if (!validId(req.params.sid)) throw error("Ambiente inválido");
      if (
        !(
          await db.query(
            "SELECT 1 FROM access WHERE user_id=$1 AND space_id=$2",
            [req.user.id, req.params.sid],
          )
        ).rowCount
      )
        throw error("Sem acesso", 403);
      req.sid = Number(req.params.sid);
      next();
    }),
  );
  async function write(req, res, fn, status = 200) {
    const key = req.get("idempotency-key");
    if (!uuid(key))
      throw error("Identificação da gravação inválida. Atualize a página.");
    const digest = hash(JSON.stringify([req.method, req.path, req.body]));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO write_requests(user_id,space_id,key,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [req.user.id, req.sid, key, digest],
      );
      const previous = (
        await client.query(
          "SELECT payload_hash,response FROM write_requests WHERE user_id=$1 AND space_id=$2 AND key=$3 FOR UPDATE",
          [req.user.id, req.sid, key],
        )
      ).rows[0];
      if (previous.payload_hash !== digest)
        throw error(
          "Esta gravação já foi usada com outros dados. Reabra o formulário.",
          409,
        );
      if (previous.response) {
        await client.query("COMMIT");
        return res
          .status(previous.response.status)
          .json(previous.response.body);
      }
      const body = await fn(client);
      await client.query(
        "UPDATE write_requests SET response=$4 WHERE user_id=$1 AND space_id=$2 AND key=$3",
        [req.user.id, req.sid, key, JSON.stringify({ status, body })],
      );
      await client.query("COMMIT");
      res.status(status).json(body);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  for (const [table, fields] of Object.entries(catalog)) {
    app.get(
      `/api/s/:sid/${table}`,
      run(async (req, res) =>
        res.json(
          (
            await db.query(
              `SELECT * FROM ${table} WHERE space_id=$1 ORDER BY name,id`,
              [req.sid],
            )
          ).rows,
        ),
      ),
    );
    app.post(
      `/api/s/:sid/${table}`,
      run(async (req, res) =>
        write(
          req,
          res,
          async (client) => {
            const values = catalogValues(table, req.body),
              slots = values.map((_, i) => "$" + (i + 2)).join(",");
            const row = (
              await client.query(
                `INSERT INTO ${table}(space_id,${fields.join(",")}) VALUES($1,${slots}) RETURNING *`,
                [req.sid, ...values],
              )
            ).rows[0];
            await audit(client, req, "create", table, row.id);
            return row;
          },
          201,
        ),
      ),
    );
    app.put(
      `/api/s/:sid/${table}/:id`,
      run(async (req, res) =>
        write(req, res, async (client) => {
          if (!validId(req.params.id) || !validId(req.body.version))
            throw error("Registro inválido. Reabra o cadastro.");
          const values = catalogValues(table, req.body);
          if (
            table === "categories" &&
            (
              await client.query(
                "SELECT 1 FROM entries WHERE category_id=$1 AND space_id=$2 AND kind<>$3 AND kind<>'transfer' LIMIT 1",
                [req.params.id, req.sid, req.body.kind],
              )
            ).rowCount
          )
            throw error("O tipo da categoria está em uso por lançamentos");
          const assignments = fields
            .map((field, i) => `${field}=$${i + 3}`)
            .join(",");
          const row = (
            await client.query(
              `UPDATE ${table} SET ${assignments},version=version+1 WHERE id=$1 AND space_id=$2 AND version=$${values.length + 3} RETURNING *`,
              [req.params.id, req.sid, ...values, req.body.version],
            )
          ).rows[0];
          if (!row)
            throw error(
              "O cadastro foi alterado ou excluído. Atualize a página antes de editar.",
              409,
            );
          await audit(client, req, "update", table, row.id);
          return row;
        }),
      ),
    );
    app.delete(
      `/api/s/:sid/${table}/:id`,
      run(async (req, res) =>
        write(req, res, async (client) => {
          if (!validId(req.params.id)) throw error("Registro inválido");
          const row = (
            await client.query(
              `DELETE FROM ${table} WHERE id=$1 AND space_id=$2 RETURNING id`,
              [req.params.id, req.sid],
            )
          ).rows[0];
          if (!row) throw error("Não encontrado", 404);
          await audit(client, req, "delete", table, row.id);
          return { ok: true };
        }),
      ),
    );
  }
  app.get(
    "/api/s/:sid/entries",
    run(async (req, res) => {
      const args = [req.sid],
        where = ["space_id=$1"];
      for (const [field, op] of [
        ["from", ">="],
        ["to", "<="],
      ])
        if (req.query[field] != null) {
          if (!validDate(req.query[field]))
            throw error("Data de filtro inválida");
          args.push(req.query[field]);
          where.push(`due_date${op}$${args.length}`);
        }
      if (req.query.from && req.query.to && req.query.from > req.query.to)
        throw error("Período inválido");
      if (req.query.pending === "true")
        where.push("paid_date IS NULL AND kind<>'transfer'");
      const offset = Number(req.query.offset ?? 0),
        limit = Number(req.query.limit ?? 250);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        throw error("Paginação inválida");
      args.push(limit, offset);
      res.json(
        (
          await db.query(
            `SELECT * FROM entries WHERE ${where.join(" AND ")} ORDER BY due_date DESC,id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
            args,
          )
        ).rows,
      );
    }),
  );
  app.post(
    "/api/s/:sid/entries",
    run(async (req, res) =>
      write(
        req,
        res,
        async (client) => {
          const value = await entryValues(client, req);
          if (
            req.body.generate_installments != null &&
            typeof req.body.generate_installments !== "boolean"
          )
            throw error("Opção de parcelas inválida");
          const generate = req.body.generate_installments === true;
          if (
            generate &&
            (value.installment_number !== 1 ||
              !value.installment_count ||
              value.installment_count < 2 ||
              value.kind === "transfer")
          )
            throw error(
              "Para gerar parcelas, comece pela parcela 1 e informe um total de 2 a 360",
            );
          const count = generate ? value.installment_count : 1;
          value.installment_group = generate ? crypto.randomUUID() : null;
          let first;
          for (let i = 0; i < count; i++) {
            const item = {
              ...value,
              ...(generate
                ? {
                    installment_number: i + 1,
                    due_date: monthDate(value.due_date, i),
                    paid_date: i === 0 ? value.paid_date : null,
                  }
                : {}),
            };
            const values = columns.map((key) => item[key] ?? null),
              slots = values.map((_, j) => "$" + (j + 2)).join(",");
            const row = (
              await client.query(
                `INSERT INTO entries(space_id,${columns.join(",")},created_by) VALUES($1,${slots},$${values.length + 2}) RETURNING *`,
                [req.sid, ...values, req.user.id],
              )
            ).rows[0];
            await audit(client, req, "create", "entries", row.id);
            first ??= row;
          }
          return { ...first, created_count: count };
        },
        201,
      ),
    ),
  );
  app.put(
    "/api/s/:sid/entries/:id",
    run(async (req, res) =>
      write(req, res, async (client) => {
        if (!validId(req.params.id) || !validId(req.body.version))
          throw error("Registro inválido. Reabra o lançamento.");
        const value = await entryValues(client, req),
          fields = columns.filter((key) => key !== "installment_group"),
          values = fields.map((key) => value[key] ?? null),
          assignments = fields.map((key, i) => `${key}=$${i + 3}`).join(",");
        const row = (
          await client.query(
            `UPDATE entries SET ${assignments},version=version+1 WHERE id=$1 AND space_id=$2 AND version=$${values.length + 3} RETURNING *`,
            [req.params.id, req.sid, ...values, req.body.version],
          )
        ).rows[0];
        if (!row)
          throw error(
            "O lançamento foi alterado ou excluído. Atualize a página antes de editar.",
            409,
          );
        await audit(client, req, "update", "entries", row.id);
        return row;
      }),
    ),
  );
  app.delete(
    "/api/s/:sid/entries/:id",
    run(async (req, res) =>
      write(req, res, async (client) => {
        if (!validId(req.params.id)) throw error("Registro inválido");
        const row = (
          await client.query(
            "DELETE FROM entries WHERE id=$1 AND space_id=$2 RETURNING id",
            [req.params.id, req.sid],
          )
        ).rows[0];
        if (!row) throw error("Não encontrado", 404);
        await audit(client, req, "delete", "entries", row.id);
        return { ok: true };
      }),
    ),
  );
  app.get(
    "/api/s/:sid/summary",
    run(async (req, res) => {
      const { from, to } = period(req),
        args = [req.sid, from, to];
      const totals = (
        await db.query(
          "SELECT kind,COALESCE(SUM(amount),0) total FROM entries WHERE space_id=$1 AND due_date BETWEEN $2 AND $3 GROUP BY kind",
          args,
        )
      ).rows;
      const byCategory = (
        await db.query(
          "SELECT COALESCE(c.name,'Sem categoria') label,e.kind,SUM(e.amount) total FROM entries e LEFT JOIN categories c ON c.id=e.category_id AND c.space_id=e.space_id WHERE e.space_id=$1 AND e.due_date BETWEEN $2 AND $3 AND e.kind<>'transfer' GROUP BY 1,2 ORDER BY total DESC",
          args,
        )
      ).rows;
      const accounts = (
        await db.query(
          "SELECT a.id,a.name,a.kind,a.opening+COALESCE((SELECT SUM(CASE WHEN e.kind='income' THEN e.amount ELSE -e.amount END) FROM entries e WHERE e.account_id=a.id AND e.space_id=a.space_id AND e.paid_date IS NOT NULL AND e.paid_date<=$2),0)+COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.to_account_id=a.id AND e.kind='transfer' AND e.paid_date IS NOT NULL AND e.paid_date<=$2 AND e.space_id=a.space_id),0) balance FROM accounts a WHERE a.space_id=$1 ORDER BY a.name",
          [req.sid, todayBR()],
        )
      ).rows;
      const cards = (
        await db.query(
          "SELECT c.id,c.name,c.credit_limit,COALESCE(SUM(CASE WHEN e.kind='expense' THEN e.amount ELSE 0 END),0) purchases FROM cards c LEFT JOIN entries e ON e.card_id=c.id AND e.space_id=c.space_id AND e.due_date BETWEEN $2 AND $3 WHERE c.space_id=$1 GROUP BY c.id ORDER BY c.name",
          args,
        )
      ).rows;
      const overdue = (
        await db.query(
          "SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) amount FROM entries WHERE space_id=$1 AND paid_date IS NULL AND due_date<$2 AND kind<>'transfer'",
          [req.sid, todayBR()],
        )
      ).rows[0];
      res.json({ totals, byCategory, accounts, cards, overdue, from, to });
    }),
  );
  app.get(
    "/api/s/:sid/audit",
    run(async (req, res) =>
      res.json(
        (
          await db.query(
            "SELECT action,entity,entity_id,at FROM audit WHERE space_id=$1 ORDER BY id DESC LIMIT 100",
            [req.sid],
          )
        ).rows,
      ),
    ),
  );
  app.get(
    "/api/s/:sid/export.csv",
    run(async (req, res) => {
      const args = [req.sid],
        where = ["e.space_id=$1"];
      if (req.query.from != null || req.query.to != null) {
        const range = period(req);
        args.push(range.from, range.to);
        where.push("e.due_date BETWEEN $2 AND $3");
      }
      const rows = (
        await db.query(
          `SELECT e.id,e.description,e.kind,e.amount,e.due_date,e.paid_date,a.name account,c.name card,cat.name category,con.name contact,e.cost_center,e.installment_number,e.installment_count,e.notes FROM entries e LEFT JOIN accounts a ON a.id=e.account_id AND a.space_id=e.space_id LEFT JOIN cards c ON c.id=e.card_id AND c.space_id=e.space_id LEFT JOIN categories cat ON cat.id=e.category_id AND cat.space_id=e.space_id LEFT JOIN contacts con ON con.id=e.contact_id AND con.space_id=e.space_id WHERE ${where.join(" AND ")} ORDER BY e.due_date DESC,e.id DESC`,
          args,
        )
      ).rows;
      const fields = [
        "id",
        "description",
        "kind",
        "amount",
        "due_date",
        "paid_date",
        "account",
        "card",
        "category",
        "contact",
        "cost_center",
        "installment_number",
        "installment_count",
        "notes",
      ];
      const labels = [
        "ID",
        "Descrição",
        "Tipo",
        "Valor",
        "Vencimento",
        "Pagamento",
        "Conta",
        "Cartão",
        "Categoria",
        "Contato",
        "Centro de custo",
        "Parcela",
        "Total de parcelas",
        "Observações",
      ];
      res
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="prestacao-contas.csv"',
        })
        .send(
          "\ufeff" +
            [
              labels.map(csvCell).join(";"),
              ...rows.map((row) =>
                fields
                  .map((field) =>
                    csvCell(
                      field === "kind"
                        ? {
                            income: "Receita",
                            expense: "Despesa",
                            transfer: "Transferência",
                          }[row[field]]
                        : field === "amount"
                          ? String(row[field]).replace(".", ",")
                          : row[field],
                    ),
                  )
                  .join(";"),
              ),
            ].join("\r\n"),
        );
    }),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Recurso não encontrado" }),
  );
  app.get(
    "/health",
    run(async (req, res) => {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    }),
  );
  app.use(
    express.static(resolve(dirname(fileURLToPath(import.meta.url)), "public"), {
      maxAge: 0,
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err.status ||
      (["23503", "23505", "23514", "22P02", "22003", "22007"].includes(err.code)
        ? 400
        : 500);
    if (status >= 500) logger.error("Erro na aplicação:", err.code || err.name);
    const message =
      err.type === "entity.parse.failed"
        ? "JSON inválido"
        : err.type === "entity.too.large"
          ? "Dados excedem o tamanho permitido"
          : err.status
            ? err.message
            : err.code === "23503"
              ? "Este cadastro está em uso por lançamentos"
              : err.code === "23505"
                ? "Registro duplicado"
                : "Não foi possível concluir a operação";
    res.status(status).json({ error: message });
  });
  return app;
}

async function start() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL necessária");
  pg.types.setTypeParser(1082, (value) => value);
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    query_timeout: 20000,
  });
  db.on("error", (err) =>
    console.error("Erro no banco:", err.code || err.name),
  );
  await initialize(db);
  const production = process.env.NODE_ENV === "production";
  const publicOrigin =
    process.env.PUBLIC_ORIGIN ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
      : "");
  const app = createApp({
    db,
    production,
    publicOrigin,
    trustProxy: process.env.TRUST_PROXY_HOPS
      ? Number(process.env.TRUST_PROXY_HOPS)
      : production
        ? 1
        : false,
  });
  const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () =>
    console.log("Sistema financeiro iniciado"),
  );
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      server.close(() => db.end().finally(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  start().catch((err) => {
    console.error("Falha na inicialização:", err.code || err.name);
    process.exit(1);
  });

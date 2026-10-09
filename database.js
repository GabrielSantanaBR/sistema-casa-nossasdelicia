import crypto from "node:crypto";
import { safeText, passwordHash } from "./finance.js";
export async function initialize(pool, env = process.env) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(87170416)");
    const schema = [
      "CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass TEXT NOT NULL,salt TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS spaces(id BIGSERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,kind TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS access(user_id BIGINT REFERENCES users(id),space_id BIGINT REFERENCES spaces(id),PRIMARY KEY(user_id,space_id))",
      "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id BIGINT REFERENCES users(id),expires TIMESTAMPTZ NOT NULL)",
      "CREATE TABLE IF NOT EXISTS accounts(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'bank',opening NUMERIC(14,2) NOT NULL DEFAULT 0)",
      "CREATE TABLE IF NOT EXISTS cards(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,closing_day INT NOT NULL DEFAULT 1,due_day INT NOT NULL DEFAULT 10)",
      "CREATE TABLE IF NOT EXISTS categories(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'expense')",
      "CREATE TABLE IF NOT EXISTS contacts(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'other',notes TEXT NOT NULL DEFAULT '')",
      "CREATE TABLE IF NOT EXISTS entries(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),description TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer')),amount NUMERIC(14,2) NOT NULL CHECK(amount>0),due_date DATE NOT NULL,paid_date DATE,account_id BIGINT REFERENCES accounts(id),to_account_id BIGINT REFERENCES accounts(id),card_id BIGINT REFERENCES cards(id),category_id BIGINT REFERENCES categories(id),contact_id BIGINT REFERENCES contacts(id),cost_center TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',installment_number INT,installment_count INT,created_by BIGINT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
      "CREATE INDEX IF NOT EXISTS entries_space_due ON entries(space_id,due_date)",
      "CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,space_id BIGINT,user_id BIGINT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id BIGINT,at TIMESTAMPTZ DEFAULT NOW())",

      "ALTER TABLE entries ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE entries ADD COLUMN IF NOT EXISTS installment_group UUID",
      "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE cards ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE categories ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
      "CREATE TABLE IF NOT EXISTS write_requests(user_id BIGINT NOT NULL REFERENCES users(id),space_id BIGINT NOT NULL REFERENCES spaces(id),key UUID NOT NULL,payload_hash TEXT NOT NULL,response JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,space_id,key))",
      "CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY)",
      "CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)",
      "CREATE INDEX IF NOT EXISTS entries_space_pending ON entries(space_id,due_date) WHERE paid_date IS NULL",
      "CREATE INDEX IF NOT EXISTS audit_space_at ON audit(space_id,at DESC)",
    ];
    for (const sql of schema) await db.query(sql);
    // Repair the first preset in each group created by the older seed order.
    await db.query(
      `UPDATE categories c SET name=c.kind,kind=c.name,version=c.version+1 FROM spaces s WHERE c.space_id=s.id AND ((s.name='Casa' AND ((c.name='expense' AND c.kind='Alimentação') OR (c.name='income' AND c.kind='Salário'))) OR (s.name='Nossas Delícias' AND ((c.name='expense' AND c.kind='Ingredientes') OR (c.name='income' AND c.kind='Vendas'))))`,
    );
    for (const [name, kind] of [
      ["Casa", "home"],
      ["Nossas Delícias", "business"],
    ])
      await db.query(
        "INSERT INTO spaces(name,kind) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",
        [name, kind],
      );
    if (
      !(
        await db.query(
          "SELECT key FROM app_settings WHERE key='category_presets_v1'",
        )
      ).rowCount
    ) {
      for (const [space, kind, names] of [
        [
          "Casa",
          "expense",
          [
            "Alimentação",
            "Moradia",
            "Água",
            "Energia",
            "Internet",
            "Transporte",
            "Saúde",
            "Educação",
            "Lazer",
            "Assinaturas",
            "Impostos",
            "Outros",
          ],
        ],
        ["Casa", "income", ["Salário", "Renda extra", "Reembolso"]],
        [
          "Nossas Delícias",
          "expense",
          [
            "Ingredientes",
            "Embalagens",
            "Fornecedores",
            "Entregas",
            "Funcionários",
            "Aluguel",
            "Energia",
            "Água",
            "Marketing",
            "Impostos",
            "Equipamentos",
            "Manutenção",
            "Taxas bancárias",
          ],
        ],
        [
          "Nossas Delícias",
          "income",
          ["Vendas", "Encomendas", "Eventos", "Outros recebimentos"],
        ],
      ]) {
        for (const name of names)
          await db.query(
            "INSERT INTO categories(space_id,name,kind) SELECT s.id,$2,$3 FROM spaces s WHERE s.name=$1 AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.space_id=s.id AND c.name=$2 AND c.kind=$3)",
            [space, name, kind],
          );
      }
      await db.query(
        "INSERT INTO app_settings(key) VALUES('category_presets_v1') ON CONFLICT DO NOTHING",
      );
    }
    if (!(await db.query("SELECT id FROM users LIMIT 1")).rowCount) {
      const email = safeText(
          env.ADMIN_EMAIL,
          255,
          "E-mail",
          true,
        ).toLowerCase(),
        password = env.ADMIN_PASSWORD || "";
      if (!email.includes("@") || password.length < 16)
        throw Error(
          "Configure ADMIN_EMAIL e ADMIN_PASSWORD com 16+ caracteres",
        );
      const salt = crypto.randomBytes(20).toString("hex"),
        pass = await passwordHash(password, salt);
      const u = (
        await db.query(
          "INSERT INTO users(email,pass,salt) VALUES($1,$2,$3) RETURNING id",
          [email, pass, salt],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO access(user_id,space_id) SELECT $1,id FROM spaces",
        [u.id],
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

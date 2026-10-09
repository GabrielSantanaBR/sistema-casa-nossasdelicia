import crypto from "node:crypto";
export const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const passwordHash = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, bytes) =>
      err ? reject(err) : resolve(bytes.toString("hex")),
    ),
  );
export function safeText(value, max, label, required = false) {
  if (value != null && typeof value !== "string")
    throw error(`${label} inválido`);
  const result = (value ?? "").trim();
  if (result.length > max || (required && !result))
    throw error(`Verifique ${label.toLowerCase()} (até ${max} caracteres)`);
  return result;
}
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.slice(0, 4) < "1000"
  )
    return false;
  const date = new Date(value + "T12:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function todayBR() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type).value)
    .join("-");
}
export function moneyValue(value, { positive = false, signed = false } = {}) {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^-?\d{1,12}(\.\d{1,2})?$/.test(String(value))
  )
    throw error("Use um valor válido com até duas casas decimais");
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (!signed && number < 0) ||
    (positive && number <= 0)
  )
    throw error("Valor inválido");
  return number.toFixed(2);
}
export const validId = (value) =>
  /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
export function monthDate(date, offset) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  const value = result.toISOString().slice(0, 10);
  if (!validDate(value))
    throw error("Parcelamento ultrapassa o intervalo de datas permitido");
  return value;
}
export function csvCell(value) {
  let text =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value ?? "");
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

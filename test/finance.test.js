import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validDate,
  moneyValue,
  monthDate,
  csvCell,
  validId,
} from "../finance.js";
test("valores monetários exatos dentro dos limites do banco", () => {
  for (const [input, expected] of [
    ["0.01", "0.01"],
    ["10.2", "10.20"],
    ["999999999999.99", "999999999999.99"],
    [-10.25, "-10.25"],
  ])
    assert.equal(moneyValue(input, { signed: true }), expected);
  for (const input of [
    "1000000000000",
    "1.005",
    "Infinity",
    "NaN",
    "1e2",
    {},
    null,
    "",
    "+1",
    "1,00",
  ])
    assert.throws(() => moneyValue(input));
});
test("datas, parcelas e ids com validação completa", () => {
  for (const date of ["2024-02-29", "2026-12-31", "9999-12-31"])
    assert.ok(validDate(date));
  for (const date of [
    "2026-02-29",
    "2026-04-31",
    "2026-00-10",
    "10/01/2026",
    null,
    [],
  ])
    assert.equal(validDate(date), false);
  assert.equal(monthDate("2024-01-31", 1), "2024-02-29");
  assert.equal(monthDate("2024-01-31", 2), "2024-03-31");
  assert.equal(monthDate("2026-12-31", 1), "2027-01-31");
  for (const id of ["01", "0", -1, 1.5, "1e2", "9007199254740993"])
    assert.equal(validId(id), false);
});
test("CSV protege fórmulas até quando precedidas por espaços", () => {
  for (const input of ["=cmd", "  =cmd", "\t+cmd", "-cmd", "@cmd", "\ncmd"])
    assert.ok(csvCell(input).startsWith("\"'"));
  assert.equal(csvCell('Nome "bom"'), '"Nome ""bom"""');
});

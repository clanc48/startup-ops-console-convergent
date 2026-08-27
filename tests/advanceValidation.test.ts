import assert from "node:assert/strict";
import test from "node:test";
import { validateAdvanceInput } from "../lib/advanceValidation.ts";

test("accepts valid input and truncates hire counts", () => {
  const result = validateAdvanceInput({
    price: 500_000,
    new_engineers: 2.9,
    new_sales: 1.4,
    salary_pct: 110,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input, {
    price: 500_000,
    new_engineers: 2,
    new_sales: 1,
    salary_pct: 110,
  });
});

test("rejects negative and non-finite values", () => {
  assert.equal(validateAdvanceInput({
    price: -1,
    new_engineers: 0,
    new_sales: 0,
    salary_pct: 100,
  }).ok, false);

  assert.equal(validateAdvanceInput({
    price: Number.POSITIVE_INFINITY,
    new_engineers: 0,
    new_sales: 0,
    salary_pct: 100,
  }).ok, false);
});

test("rejects out-of-range salary percentages", () => {
  assert.equal(validateAdvanceInput({
    price: 100,
    new_engineers: 0,
    new_sales: 0,
    salary_pct: 0,
  }).ok, false);

  assert.equal(validateAdvanceInput({
    price: 100,
    new_engineers: 0,
    new_sales: 0,
    salary_pct: 201,
  }).ok, false);
});

test("rejects unexpected fields instead of silently accepting them", () => {
  assert.equal(validateAdvanceInput({
    price: 100,
    new_engineers: 0,
    new_sales: 0,
    salary_pct: 100,
    admin: true,
  }).ok, false);
});

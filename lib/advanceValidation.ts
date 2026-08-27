import { z } from "zod";

const advanceInputSchema = z
  .object({
    price: z.number().finite().min(0),
    new_engineers: z.number().finite().min(0),
    new_sales: z.number().finite().min(0),
    salary_pct: z.number().finite().min(1).max(200),
  })
  .strict();

export type AdvanceInput = {
  price: number;
  new_engineers: number;
  new_sales: number;
  salary_pct: number;
};

export type AdvanceValidationResult =
  | { ok: true; input: AdvanceInput }
  | { ok: false; msg: string };

export function validateAdvanceInput(value: unknown): AdvanceValidationResult {
  const parsed = advanceInputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0];
    return {
      ok: false,
      msg: field ? `Invalid ${String(field)}` : "Invalid request body",
    };
  }

  return {
    ok: true,
    input: {
      price: parsed.data.price,
      new_engineers: Math.trunc(parsed.data.new_engineers),
      new_sales: Math.trunc(parsed.data.new_sales),
      salary_pct: parsed.data.salary_pct,
    },
  };
}

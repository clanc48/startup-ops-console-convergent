export type SimInput = {
  price: number;
  new_engineers: number;
  new_sales: number;
  salary_pct: number;
};

export type GameRow = {
  id: string;
  user_id: string;
  year: number;
  quarter: number;
  cash: number;
  engineers: number;
  sales_staff: number;
  quality: number;
  is_over: boolean;
  ended_reason: string | null;
};

export type SimOutput = {
  demand: number;
  units: number;
  revenue: number;
  payroll: number;
  net_income: number;
  cash_end: number;
  quality_end: number;

  next_year: number;
  next_quarter: number;
  engineers_end: number;
  sales_end: number;

  is_over: boolean;
  ended_reason: string | null;
};

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function simulateQuarter(prev: GameRow, input: SimInput): SimOutput {
  const price = Math.max(0, input.price);
  const newEng = clampInt(input.new_engineers, 0, 1_000_000);
  const newSales = clampInt(input.new_sales, 0, 1_000_000);
  const salaryPct = Math.max(0, input.salary_pct);

  const engineers_end = prev.engineers + newEng;
  const sales_end = prev.sales_staff + newSales;

  const quality_end = clampInt(prev.quality + engineers_end * 0.5, 0, 100);

  const demand = Math.max(0, quality_end * 10 - price * 0.0001);

  const units = Math.floor(demand * sales_end * 0.5);

  const revenue = units * price;

  // Spec: industry avg salary is $30,000 per quarter.
  const INDUSTRY_AVG_SALARY_PER_QUARTER = 30_000;
  const payroll = (engineers_end + sales_end) * INDUSTRY_AVG_SALARY_PER_QUARTER * (salaryPct / 100);

  const net_income = revenue - payroll;

  const hiring_cost = (newEng + newSales) * 5000;

  const cash_end = prev.cash + net_income - hiring_cost;

  let next_year = prev.year;
  let next_quarter = prev.quarter + 1;
  if (next_quarter > 4) {
    next_quarter = 1;
    next_year += 1;
  }

  let is_over = false;
  let ended_reason: string | null = null;

  if (cash_end <= 0) {
    is_over = true;
    ended_reason = "bankrupt";
  } else if (prev.year === 10 && prev.quarter === 4) {
    // Win condition: successfully complete Y10Q4 with positive cash.
    is_over = true;
    ended_reason = "won";
    // Keep the snapshot pinned to the final period for clarity.
    next_year = 10;
    next_quarter = 4;
  }

  return {
    demand,
    units,
    revenue,
    payroll,
    net_income,
    cash_end,
    quality_end,
    next_year,
    next_quarter,
    engineers_end,
    sales_end,
    is_over,
    ended_reason,
  };
}

import type { Insight } from "@/lib/insights";

export type GameState = {
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

export type QuarterRow = {
  id: string;
  game_id: string;
  year: number;
  quarter: number;

  price: number;
  new_engineers: number;
  new_sales: number;
  salary_pct: number;

  demand: number;
  units: number;
  revenue: number;
  payroll: number;
  net_income: number;
  cash_end: number;
  quality_end: number;

  // Optional: filled by AI workflow demo.
  ai_summary?: string | null;

  integrity_hash?: string | null;

  created_at: string;
};

export type GamePayload = {
  game: GameState;
  last_quarters: QuarterRow[];
  insights: Insight[];
  cumulative_profit?: number;
};

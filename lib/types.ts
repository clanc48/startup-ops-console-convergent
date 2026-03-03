
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

  integrity_hash?: string | null;
  ai_summary?: string | null;

  created_at: string;

  verified?: boolean;
};

export type GamePayload = {
  game: GameState;
  last_quarters: QuarterRow[];
  insights: Insight[];
  cumulative_profit?: number;
};

export type JobStatus = "queued" | "running" | "done" | "failed";

export type JobRow = {
  id: string;
  type: string;
  status: JobStatus;
  user_id?: string | null;
  game_id?: string | null;
  quarter_id?: string | null;
  payload: any;
  attempts: number;
  max_attempts: number;
  locked_at?: string | null;
  locked_by?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

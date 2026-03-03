import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import type { GameState, QuarterRow } from "@/lib/types";

export async function generateExecutiveSummary(args: { game: GameState; quarter: QuarterRow; lastQuarters: QuarterRow[] }) {
  const { game, quarter, lastQuarters } = args;

  const context = {
    current: { year: game.year, quarter: game.quarter, cash: game.cash, engineers: game.engineers, sales: game.sales_staff, quality: game.quality },
    latestQuarter: {
      period: `Y${quarter.year} Q${quarter.quarter}`,
      price: quarter.price,
      demand: quarter.demand,
      units: quarter.units,
      revenue: quarter.revenue,
      payroll: quarter.payroll,
      net_income: quarter.net_income,
      cash_end: quarter.cash_end,
      quality_end: quarter.quality_end,
      verified: quarter.verified ?? null,
    },
    last4: lastQuarters.slice(0, 4).map((q) => ({
      period: `Y${q.year} Q${q.quarter}`,
      revenue: q.revenue,
      net_income: q.net_income,
      cash_end: q.cash_end,
      quality_end: q.quality_end,
    })),
  };

  const prompt = [
    "You are an executive operator reviewing a company dashboard.",
    "Write a concise executive summary with:",
    "1) What happened last quarter (revenue/net/runway)",
    "2) Risk assessment (runway, burn, quality, pricing sensitivity)",
    "3) 2-3 specific recommendations for next quarter decisions (price/hiring/salary%)",
    "Keep it under 130 words. No fluff.",
    "Data:",
    JSON.stringify(context),
  ].join("\n");

  const { text } = await generateText({
    model: openai("gpt-4.1-mini"),
    prompt,
  });

  return text.trim();
}

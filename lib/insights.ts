
import type { GameState, QuarterRow } from "@/lib/types";

export type InsightSeverity = "good" | "warn" | "bad" | "info";
export type InsightKey =
  | "audit"
  | "runway"
  | "profitability"
  | "quality"
  | "pricing"
  | "sales_leverage"
  | "payroll_burn";

export type Insight = {
  key: InsightKey;
  severity: InsightSeverity;
  title: string;
  detail: string;
  metric?: { label: string; value: string };
  recommendation?: string;
};

function fmtMoney(n: number) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.round(Math.abs(n));
  return `${sign}$${abs.toLocaleString()}`;
}

export function computeInsights(game: GameState, last: QuarterRow[]): Insight[] {
  const newest = last[0];
  const prev = last[1];

  const cash = Number(game.cash);
  const quality = Number(game.quality);

  const net = newest ? Number(newest.net_income) : 0;
  const payroll = newest
    ? Math.max(1, Number(newest.payroll))
    : Math.max(1, (game.engineers + game.sales_staff) * 100_000);

  const runway = cash / payroll;

  const units = newest ? Number(newest.units) : 0;
  const sales = Math.max(1, game.sales_staff);
  const unitsPerSales = units / sales;

  const priceNow = newest ? Number(newest.price) : null;
  const pricePrev = prev ? Number(prev.price) : null;

  const insights: Insight[] = [];

  if (last.length > 0) {
    const unverified = last.some((q) => q.verified === false);
    insights.push({
      key: "audit",
      severity: unverified ? "warn" : "good",
      title: "Audit Integrity",
      detail: unverified
        ? "One or more recent quarters failed integrity verification."
        : "All recent quarters are integrity-verified.",
      recommendation: unverified
        ? "Review quarter generation path; ensure only server writes authoritative fields."
        : "Integrity checks passing. Ledger is consistent.",
    });
  }

  const runwaySeverity: InsightSeverity =
    runway >= 4 ? "good" : runway >= 2 ? "warn" : "bad";

  insights.push({
    key: "runway",
    severity: runwaySeverity,
    title: "Runway",
    detail:
      runway >= 4
        ? `Healthy runway: ${runway.toFixed(2)} quarters at current burn.`
        : runway >= 2
        ? `Watch runway: ${runway.toFixed(2)} quarters. Limit headcount growth.`
        : `Critical runway: ${runway.toFixed(2)} quarters. Consider cost cuts or improving net income.`,
    metric: { label: "Runway", value: `${runway.toFixed(2)} qtrs` },
    recommendation:
      runway < 2
        ? "Freeze hiring; stabilize payroll and push net income positive."
        : runway < 4
        ? "Hire selectively; focus on efficiency."
        : "You can invest in growth—keep monitoring burn.",
  });

  insights.push({
    key: "profitability",
    severity: net >= 0 ? "good" : "bad",
    title: "Profitability",
    detail:
      net >= 0
        ? `Net income positive: ${fmtMoney(net)} last quarter.`
        : `Net income negative: ${fmtMoney(net)} last quarter.`,
    metric: { label: "Net", value: fmtMoney(net) },
    recommendation:
      net >= 0
        ? "Reinvest cautiously (quality/sales) without collapsing runway."
        : "Reduce burn or improve revenue drivers (quality/sales/price).",
  });

  insights.push({
    key: "quality",
    severity: quality >= 80 ? "good" : quality >= 60 ? "warn" : "bad",
    title: "Product Quality",
    detail:
      quality >= 80
        ? `Quality strong (${quality}/100). Demand should be resilient.`
        : quality >= 60
        ? `Quality moderate (${quality}/100). Gains here likely improve demand.`
        : `Quality low (${quality}/100). Expect suppressed demand.`,
    metric: { label: "Quality", value: `${quality}/100` },
    recommendation:
      quality < 80 ? "Prioritize engineers until quality reaches 80+." : "Maintain quality; avoid over-hiring.",
  });

  insights.push({
    key: "payroll_burn",
    severity: runway >= 2 ? "info" : "warn",
    title: "Payroll Burn",
    detail: `Current payroll: ${fmtMoney(payroll)} per quarter.`,
    metric: { label: "Payroll/Qtr", value: fmtMoney(payroll) },
    recommendation:
      runway < 2 ? "Comp decisions must protect runway." : "Keep burn aligned to outcomes.",
  });

  insights.push({
    key: "sales_leverage",
    severity: unitsPerSales >= 50 ? "good" : unitsPerSales >= 20 ? "warn" : "bad",
    title: "Sales Leverage",
    detail: `Units per sales staff: ${unitsPerSales.toFixed(1)} (last quarter).`,
    metric: { label: "Units/Sales", value: unitsPerSales.toFixed(1) },
    recommendation:
      unitsPerSales < 20
        ? "Improve demand (quality/price) before hiring more sales."
        : unitsPerSales < 50
        ? "Tune price/quality; monitor leverage."
        : "Leverage strong—consider scaling sales if runway supports it.",
  });

  if (priceNow != null && pricePrev != null) {
    const pct = pricePrev === 0 ? 0 : (priceNow - pricePrev) / pricePrev;
    const sev: InsightSeverity = Math.abs(pct) < 0.05 ? "info" : pct > 0 ? "warn" : "good";

    insights.push({
      key: "pricing",
      severity: sev,
      title: "Pricing Change",
      detail:
        pct > 0
          ? `Price increased ${(pct * 100).toFixed(1)}% vs prior quarter. Watch demand sensitivity.`
          : pct < 0
          ? `Price decreased ${Math.abs(pct * 100).toFixed(1)}% vs prior quarter. Monitor revenue impact.`
          : "Price unchanged vs prior quarter.",
      metric: { label: "ΔPrice", value: `${(pct * 100).toFixed(1)}%` },
      recommendation:
        pct > 0
          ? "If demand dips, offset with quality improvements."
          : pct < 0
          ? "Ensure units growth compensates for lower price."
          : "Test small price moves; measure impact.",
    });
  }

  return insights.slice(0, 6);
}

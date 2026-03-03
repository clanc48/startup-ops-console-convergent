
"use client";
import React from "react";

export function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={`ui-kpi ${tone ?? ""}`.trim()}>
      <div className="ui-kpiLabel">{label}</div>
      <div className="ui-kpiValue">{value}</div>
      {hint && <div className="ui-kpiHint">{hint}</div>}
    </div>
  );
}

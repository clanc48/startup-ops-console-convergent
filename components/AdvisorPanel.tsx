
"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import type { Insight } from "@/lib/insights";

export default function AdvisorPanel({ insights }: { insights: Insight[] }) {
  return (
    <Panel>
      <Panel.Header title="Advisor & Alerts" subtitle="Server-generated operational insights." right={<Badge tone="warn">Beta</Badge>} />
      <Panel.Body>
        {insights.length === 0 ? (
          <div className="ui-muted">No insights yet. Advance a quarter to generate signals.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {insights.map((i) => (
              <InsightCard key={i.key} insight={i} />
            ))}
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const tone = insight.severity === "info" ? undefined : insight.severity;

  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.05)", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 800 }}>{insight.title}</div>
        {tone ? <Badge tone={tone}>{tone.toUpperCase()}</Badge> : <span className="ui-muted" style={{ fontSize: 11 }}>INFO</span>}
      </div>

      <div className="ui-muted" style={{ fontSize: 12, marginTop: 6 }}>{insight.detail}</div>

      {insight.metric && (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
          <span className="ui-muted" style={{ fontSize: 12 }}>{insight.metric.label}</span>
          <b style={{ fontSize: 12 }}>{insight.metric.value}</b>
        </div>
      )}

      {insight.recommendation && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.10)" }}>
          <div className="ui-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px" }}>Recommendation</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>{insight.recommendation}</div>
        </div>
      )}
    </div>
  );
}

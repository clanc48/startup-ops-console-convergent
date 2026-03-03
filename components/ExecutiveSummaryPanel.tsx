
"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import type { QuarterRow } from "@/lib/types";

export default function ExecutiveSummaryPanel({ newestQuarter }: { newestQuarter?: QuarterRow }) {
  const summary = newestQuarter?.ai_summary;

  return (
    <Panel>
      <Panel.Header title="AI Executive Summary" subtitle="Generated from last quarter results (via job queue)." right={<Badge tone="warn">AI</Badge>} />
      <Panel.Body>
        {!summary ? (
          <div className="ui-muted">No AI summary yet. Advance a quarter and run the worker once.</div>
        ) : (
          <div style={{ lineHeight: 1.55, fontSize: 13 }}>{summary}</div>
        )}
      </Panel.Body>
    </Panel>
  );
}

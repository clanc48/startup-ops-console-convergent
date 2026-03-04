"use client";

import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useState } from "react";

export default function JobControlsPanel({ onAfterRun }: { onAfterRun: () => void }) {
 const [busy, setBusy] = useState(false);
 const [msg, setMsg] = useState<string | null>(null);
 const isProd = process.env.NODE_ENV === "production";

 async function runOnce() {
 setBusy(true);
 setMsg(null);
 try {
 if (isProd) {
 setMsg("Worker is disabled in production. Schedule it via cron/scheduler.");
 return;
 }
 const res = await fetch("/api/jobs/worker", { method: "POST" });
 const text = await res.text();
 setMsg(res.ok ? `Worker ran: ${text}` : `Worker error: ${text}`);
 onAfterRun();
 } finally {
 setBusy(false);
 }
 }

 return (
 <Panel>
 <Panel.Header title="Background Jobs" subtitle="Queue + worker (demo)." right={<Badge>Queue</Badge>} />
 <Panel.Body>
 <Button onClick={runOnce} disabled={busy || isProd}>
 {busy ? "Running..." : "Run Worker Once"}
 </Button>
 {msg && <div className="ui-muted" style={{ marginTop:10, fontSize:12 }}>{msg}</div>}
 <div className="ui-muted" style={{ marginTop:10, fontSize:12 }}>
 In production you'd trigger the worker via cron/scheduler; this button is for showcasing queue mechanics.
 </div>
 </Panel.Body>
 </Panel>
 );
}

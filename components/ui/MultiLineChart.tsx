"use client";

import { useMemo } from "react";

function clamp(n: number, a: number, b: number) {
 return Math.max(a, Math.min(b, n));
}

type Series = {
 key: string;
 label: string;
 values: number[];
 color: string;
 width?: number;
};

export function MultiLineChart({
 title,
 subtitle,
 series,
 width =900,
 height =220,
 xLabels: _xLabels,
 mode,
}: {
 title: string;
 subtitle?: string;
 series: Series[];
 width?: number;
 height?: number;
 xLabels?: string[];
 mode?: string;
}) {
 // mode is currently informational (rendering is the same). Kept for API compatibility.
 void mode;
 void _xLabels;

 const computed = useMemo(() => {
 const normalized = (series ?? []).map((s) => ({
 ...s,
 values: (s.values ?? []).map((v) => (Number.isFinite(v) ? Number(v) :0)),
 }));

 const len = Math.max(0, ...normalized.map((s) => s.values.length));
 if (len <2) {
 return {
 len:0,
 paths: [],
 globalMin:0,
 globalMax:0,
 last: [] as { key: string; label: string; value: number; color: string }[],
 };
 }

 const padding =16;
 const innerW = Math.max(1, width - padding *2);
 const innerH = Math.max(1, height - padding *2);
 const dx = innerW / (len -1);

 // Global min/max for display only
 let globalMin = Infinity;
 let globalMax = -Infinity;

 const paths = normalized.map((s) => {
 const rawMin = Math.min(...s.values);
 const rawMax = Math.max(...s.values);
 globalMin = Math.min(globalMin, rawMin);
 globalMax = Math.max(globalMax, rawMax);

 // Per-series scaling so each line remains visible even when magnitudes differ.
 let dmin = rawMin;
 let dmax = rawMax;
 const span0 = Math.max(1e-9, dmax - dmin);
 const pad = span0 *0.08;
 dmin -= pad;
 dmax += pad;
 const span = Math.max(1e-9, dmax - dmin);

 const pts = Array.from({ length: len }, (_, i) => {
 const yv = s.values[i] ?? s.values[s.values.length -1] ??0;
 const x = padding + i * dx;
 const t = (yv - dmin) / span;
 const y = padding + (1 - clamp(t,0,1)) * innerH;
 return { x, y };
 });

 const d = pts
 .map((p, i) => `${i ===0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
 .join(" ");

 return { key: s.key, label: s.label, color: s.color, d };
 });

 if (!Number.isFinite(globalMin)) globalMin =0;
 if (!Number.isFinite(globalMax)) globalMax =0;

 const last = normalized.map((s) => ({
 key: s.key,
 label: s.label,
 value: s.values[s.values.length -1] ??0,
 color: s.color,
 }));

 return { len, paths, globalMin, globalMax, last };
 }, [series, width, height]);

 if (computed.len <2) {
 return (
 <div className="ui-muted" style={{ fontSize:12 }}>
 Not enough data.
 </div>
 );
 }

 return (
 <div style={{ width: "100%" }}>
 <div style={{ display: "flex", justifyContent: "space-between", gap:12, alignItems: "baseline", flexWrap: "wrap" }}>
 <div>
 <div style={{ fontWeight:600 }}>{title}</div>
 {subtitle && (
 <div className="ui-muted" style={{ fontSize:12 }}>
 {subtitle}
 </div>
 )}
 </div>
 <div style={{ display: "flex", gap:10, flexWrap: "wrap", justifyContent: "flex-end" }}>
 {computed.last.map((s) => (
 <div key={s.key} style={{ display: "flex", gap:8, alignItems: "baseline" }}>
 <span style={{ width:10, height:10, borderRadius:3, background: s.color, display: "inline-block" }} />
 <span className="ui-muted" style={{ fontSize:12 }}>
 {s.label}
 </span>
 <span style={{ fontWeight:600, fontSize:12 }}>{Math.round(s.value).toLocaleString()}</span>
 </div>
 ))}
 </div>
 </div>

 <svg
 width="100%"
 height={height}
 viewBox={`00 ${width} ${height}`}
 role="img"
 aria-label="chart"
 style={{ display: "block", marginTop:10 }}
 >
 <line x1={16} y1={height -16} x2={width -16} y2={height -16} stroke="rgba(255,255,255,.10)" strokeWidth={1} />
 {computed.paths.map((p) => (
 <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
 ))}
 </svg>
 </div>
 );
}


"use client";

export default function OfficeGrid({ engineers, sales }: { engineers: number; sales: number }) {
  const capacity = 30;
  const seats: ("E" | "S" | "EMPTY")[] = [];

  for (let i = 0; i < engineers; i++) seats.push("E");
  for (let i = 0; i < sales; i++) seats.push("S");
  while (seats.length < capacity) seats.push("EMPTY");
  seats.splice(capacity);

  return (
    <div>
      <div className="ui-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Engineers: <b>{engineers}</b> • Sales: <b>{sales}</b> • Empty: <b>{Math.max(0, capacity - engineers - sales)}</b>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 8 }}>
        {seats.map((s, idx) => (
          <Desk key={idx} kind={s} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }} className="ui-muted">
        <span><b>E</b> Engineer</span>
        <span><b>S</b> Sales</span>
        <span><b>·</b> Empty</span>
      </div>
    </div>
  );
}

function Desk({ kind }: { kind: "E" | "S" | "EMPTY" }) {
  const label = kind === "EMPTY" ? "·" : kind;
  const bg = kind === "E" ? "#eef6ff" : kind === "S" ? "#fff3e8" : "#f7f7f7";
  const border = kind === "E" ? "#cfe6ff" : kind === "S" ? "#ffd9bd" : "#e6e6e6";

  return (
    <div
      style={{
        height: 44,
        borderRadius: 10,
        border: `1px solid ${border}`,
        background: bg,
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        userSelect: "none",
        color: "#0b1220",
      }}
      title={kind === "EMPTY" ? "Empty desk" : kind === "E" ? "Engineer" : "Sales"}
    >
      {label}
    </div>
  );
}

"use client";
import React, { useCallback, useEffect, useState } from "react";

export function Sidebar({
  items,
  footer,
}: {
  items: { label: string; href?: string; active?: boolean }[];
  footer?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLocalhost =
    mounted &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const handleClose = useCallback(async () => {
    if (!confirm("Close the application (shutdown dev server)? This will stop the local server. Continue?")) return;

    // User-facing safety prompt: makes sure they understand this impacts their current instance.
    const confirmText = prompt('Type "CLOSE" to confirm you are the only one using this app instance:');
    if (confirmText !== "CLOSE") return alert("Shutdown cancelled.");

    try {
      const res = await fetch("/api/close", { method: "POST" });
      if (res.ok) {
        alert("Server shutting down. Dev server will stop shortly.");
      } else {
        const txt = await res.text();
        alert(`Failed to shutdown: ${res.status} ${txt}`);
      }
    } catch (e: any) {
      alert(`Shutdown request failed: ${e?.message ?? String(e)}`);
    }
  }, []);

  return (
    <aside className="ui-sidebar">
      <div className="ui-navTitle">Navigation</div>
      <nav className="ui-nav">
        {items.map((it) => (
          <a
            key={it.label}
            href={it.href ?? "#"}
            className={`ui-navItem ${it.active ? "active" : ""}`.trim()}
          >
            {it.label}
          </a>
        ))}
      </nav>
      {footer && <div style={{ marginTop: 14 }}>{footer}</div>}

      {isLocalhost && (
        <div style={{ marginTop: 14 }}>
          <button
            className="ui-btn ui-btn-danger"
            onClick={handleClose}
            style={{ backgroundColor: "red", color: "black", border: "none", padding: "8px12px", cursor: "pointer" }}
          >
            Close Application
          </button>
        </div>
      )}
    </aside>
  );
}

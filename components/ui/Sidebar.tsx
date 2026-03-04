"use client";
import React from "react";

export function Sidebar({
  items,
  footer,
  children,
}: {
  items: { label: string; href?: string; active?: boolean }[];
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
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
      {children}
    </aside>
  );
}

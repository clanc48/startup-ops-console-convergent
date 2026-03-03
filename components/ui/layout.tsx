
"use client";
import React from "react";

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="ui-shell">{children}</div>;
}

export function Layout({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ui-layout">
      {sidebar}
      <div className="ui-content">{children}</div>
    </div>
  );
}

export function Stack({ children }: { children: React.ReactNode }) {
  return <div className="ui-stack">{children}</div>;
}

export function Grid({ variant, children }: { variant?: "kpi" | "main"; children: React.ReactNode }) {
  return <div className={`ui-grid ${variant ?? ""}`.trim()}>{children}</div>;
}

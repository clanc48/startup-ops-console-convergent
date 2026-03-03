
"use client";
import React from "react";

export function Badge({ tone, children }: { tone?: "good" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`ui-badge ${tone ?? ""}`.trim()}>{children}</span>;
}

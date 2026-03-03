"use client";
import React from "react";

type AlertTone = "good" | "warn" | "bad";

export function Alert({ tone, children }: { tone?: AlertTone; children: React.ReactNode }) {
 return <div className={`ui-alert ${tone ?? ""}`.trim()}>{children}</div>;
}

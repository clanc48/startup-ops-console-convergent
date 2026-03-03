
"use client";
import React from "react";

export function Button({
  variant = "solid",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost" }) {
  const cls = `ui-btn ${variant === "ghost" ? "ghost" : ""}`.trim();
  return <button {...props} className={`${cls} ${props.className ?? ""}`.trim()} />;
}

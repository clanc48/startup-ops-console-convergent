
"use client";
import React from "react";

export function Topbar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="ui-topbar">
      <div className="ui-brand">
        <div className="ui-logo">LS</div>
        <div>
          <div className="ui-brandName">{title}</div>
          {subtitle && <div className="ui-brandSub">{subtitle}</div>}
        </div>
      </div>
      <div className="ui-topbarRight">{right}</div>
    </header>
  );
}

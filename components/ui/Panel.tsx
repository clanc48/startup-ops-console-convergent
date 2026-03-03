
"use client";
import React from "react";

export function Panel({ children }: { children: React.ReactNode }) {
  return <div className="ui-panel">{children}</div>;
}

Panel.Header = function PanelHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="ui-panelHead">
      <div>
        <div className="ui-panelTitle">{title}</div>
        {subtitle && <div className="ui-panelSub">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
};

Panel.Body = function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="ui-panelBody">{children}</div>;
};

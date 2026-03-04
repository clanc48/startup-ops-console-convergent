"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type SidebarRenderCtx = { open: boolean; toggle: () => void };

function readSidebarOpenFromStorage(): boolean {
  try {
    const raw = window.localStorage.getItem("ui.sidebar.open");
    return raw !== "0";
  } catch {
    return true;
  }
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className="ui-shell">{children}</div>;
}

export function Layout({
  sidebar,
  children,
}: {
  sidebar: ReactNode | ((ctx: SidebarRenderCtx) => ReactNode);
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    // `window` is only available on the client, but this component is client-only.
    return readSidebarOpenFromStorage();
  });

  const layoutClass = useMemo(() => {
    return `ui-layout ${open ? "" : "collapsed"}`.trim();
  }, [open]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("ui.sidebar.open", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className={layoutClass}>
      <div className={`ui-sidebarSlot ${open ? "" : "hidden"}`.trim()}>
        {typeof sidebar === "function" ? sidebar({ open, toggle }) : sidebar}
      </div>

      {!open && (
        <button className="ui-sidebarReopen" onClick={toggle} aria-label="Expand sidebar" title="Show menu">
          ?
        </button>
      )}

      <div className="ui-content">{children}</div>
    </div>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className="ui-stack">{children}</div>;
}

export function Grid({ variant, children }: { variant?: string; children: ReactNode }) {
  return <div className={`ui-grid ${variant ?? ""}`.trim()}>{children}</div>;
}

"use client";

import type { ReactNode } from "react";

/**
 * Minimal table wrapper with a consistent layout.
 * Used for history/ledger views across the app.
 */
export function Table({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="ui-tableWrap">
      <table className="ui-table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

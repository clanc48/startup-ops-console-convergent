
"use client";
import React from "react";

export function Table({ columns, children }: { columns: string[]; children: React.ReactNode }) {
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

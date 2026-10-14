import type { ReactNode } from 'react';

export type SummaryTableRow = {
  // The row's own stable React key — not shown.
  key: string;
  // The row's caption, rendered in the muted caption tone on the left —
  // mirrors the deposit/bond value-breakdown row's own label cell.
  label: string;
  // The row's trailing content, right-aligned by the shared row layout. A
  // caller renders its own value primitive here (a plain `Text`, a
  // `MoneyText`) — `SummaryTable` never formats a value itself, only lays
  // the row out.
  value: ReactNode;
  // Optional testID for the small Box wrapping this row's VALUE only (never
  // the label) — a caller migrating an existing row (e.g.
  // `statement-import-transaction-count`) keeps its exact pre-existing
  // `toHaveTextContent` assertion this way, scoped to the value text alone.
  testID?: string;
  // For a value that is free text and can run long: the label keeps its width and the value wraps
  // inside the row. Absent, the row lays out as it always has, for the short values of the rest.
  wraps?: true;
};

export type SummaryTableProps = {
  // An optional heading row rendered above the data rows (e.g. a statement's
  // own display name, "Monobank (CSV)") — omitted renders no heading at all,
  // the deposit/bond value breakdown's own shape (it has no title row of its
  // own, only the data rows below the Value header it sits under).
  title?: string;
  rows: SummaryTableRow[];
  // Applied to the outer container.
  testID?: string;
};

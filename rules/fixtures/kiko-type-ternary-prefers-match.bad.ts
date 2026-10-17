// Semgrep fixture (POSITIVE): kiko-code-style's "`ts-pattern` for exhaustive mapping" reads a
// discriminated union through `match`, so a new variant is a type error rather than a silent
// fall-through to the else branch. `kiko-type-ternary-prefers-match` MUST report a finding on each
// pinned line below: a ternary on one `type` literal.
type Row = { type: 'heading'; title: string } | { type: 'currency'; code: string };

declare const row: Row;
declare const holder: { row: Row };

// EXPECT-FINDING
export const label = row.type === 'heading' ? row.title : 'Other';

// EXPECT-FINDING
export const nested = holder.row.type === 'currency' ? 1 : 0;

// EXPECT-FINDING
export const asReturn = (): string => (row.type === 'heading' ? 'Heading' : 'Currency');

// EXPECT-FINDING
export const asArgument = String(row.type === 'currency' ? 'yes' : 'no');

export const multiLine =
  // EXPECT-FINDING
  row.type === 'heading' ? { heading: true, key: row.title } : { heading: false, key: 'none' };

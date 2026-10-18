// Semgrep fixture (NEGATIVE): a union read through `match`, and ternaries that are not a test of
// one `type` literal, are out of the rule's reach. `kiko-type-ternary-prefers-match` must draw
// ZERO findings from this file.
import { match } from 'ts-pattern';

type Row = { type: 'heading'; title: string } | { type: 'currency'; code: string };

declare const row: Row;
declare const flag: boolean;
declare const other: { type: string };

export const label = match(row)
  .with({ type: 'heading' }, ({ title }) => title)
  .with({ type: 'currency' }, ({ code }) => code)
  .exhaustive();

// A plain condition, a different property, and a comparison of two values are no literal test.
export const plain = flag ? 'a' : 'b';

export const otherProperty = other.type.length === 3 ? 'a' : 'b';

export const twoTypes = row.type === other.type ? 'same' : 'different';

// An inequality is a different shape from the equality the rule names.
export const notEqual = row.type !== 'heading' ? 'currency' : 'heading';

// A type read in a statement `if`, not a ternary.
export const viaIf = (): string => {
  if (row.type === 'heading') {
    return 'heading';
  }

  return 'currency';
};

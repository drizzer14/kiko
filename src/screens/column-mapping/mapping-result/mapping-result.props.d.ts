import type { ColumnMappingRowError } from '../../../statement-import/column-mapping';
import type { PreviewStats } from '../../statement-import/preview-stats/preview-stats';

export type MappingResultProps = {
  // `undefined` when the mapping is not yet structurally complete (a
  // required column/date-format is still unset) OR `applyColumnMapping`
  // itself failed — either way the screen shows `columnMapping.incomplete`
  // rather than a stale/partial result. A currency-column-unresolved throw
  // is deliberately NOT distinguished here — that specific reason shows on
  // the currency field itself (`columnMapping.currencyColumnUnresolvedError`,
  // gated on the first Import press, same as every other field error), not
  // as a second copy of the same message in this block.
  stats: PreviewStats | undefined;
  rowErrors: ColumnMappingRowError[];
  // Every required field IS mapped and `applyColumnMapping` succeeded, but
  // literally zero rows survived their own per-row checks — no single INPUT
  // field is at fault (the itemized `rowErrors` below explain the real, and
  // possibly mixed, per-row reasons), so this renders on the Result block
  // itself instead. Already gated by the caller on the first Import press
  // (`columnMapping.noRowsResolvedError` translated), matching every other
  // field's validate-on-press message — `undefined` renders nothing.
  noRowsResolvedError?: string;
  // The chosen target holding's name, forwarded to `ExampleTransaction`'s
  // own `holdingName` prop (F3 fix round 2, N3) — feeds its income/expense
  // default-title fallback. `undefined` before a holding is chosen.
  holdingName?: string;
};

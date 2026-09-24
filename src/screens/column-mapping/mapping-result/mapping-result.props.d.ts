import type { ColumnMappingRowError } from '../../../statement-import/column-mapping';
import type { PreviewStats } from '../../statement-import/preview-stats/preview-stats';

export type MappingResultProps = {
  // `undefined` when the mapping is not yet structurally complete (a
  // required column/date-format is still unset) OR `applyColumnMapping`
  // itself failed — either way the screen shows `columnMapping.incomplete`
  // rather than a stale/partial result.
  stats: PreviewStats | undefined;
  rowErrors: ColumnMappingRowError[];
  // F4 audit 6: true when every required field IS mapped but the
  // currency-column mapping resolved NO row's currency at all
  // (`applyColumnMapping` threw) — shows the specific
  // `currencyColumnUnresolvedError` hint instead of the generic
  // `incomplete` one, which used to misleadingly blame "missing" columns
  // that were actually already mapped.
  currencyUnresolved?: boolean;
  // The chosen target holding's name, forwarded to `ExampleTransaction`'s
  // own `holdingName` prop (F3 fix round 2, N3) — feeds its income/expense
  // default-title fallback. `undefined` before a holding is chosen.
  holdingName?: string;
};

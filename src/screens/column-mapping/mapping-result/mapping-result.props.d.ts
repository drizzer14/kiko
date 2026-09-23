import type { ColumnMappingRowError } from '../../../statement-import/column-mapping';
import type { PreviewStats } from '../../statement-import/preview-stats/preview-stats';

export type MappingResultProps = {
  // `undefined` when the mapping is not yet structurally complete (a
  // required column/date-format is still unset) OR `applyColumnMapping`
  // itself failed — either way the screen shows `columnMapping.incomplete`
  // rather than a stale/partial result.
  stats: PreviewStats | undefined;
  rowErrors: ColumnMappingRowError[];
};

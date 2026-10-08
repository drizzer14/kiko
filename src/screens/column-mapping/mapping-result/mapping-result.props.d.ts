import type { ImportBalancePreview } from '@kiko/transactions/repo';
import type { PreviewStats } from '@kiko/statement-import/preview-stats';
import type { ColumnMappingRowError } from '@kiko/statement-import/column-mapping';

export type MappingResultProps = {
  // `undefined` while the mapping is not yet structurally complete OR once
  // it is but `applyColumnMapping` still failed (a `currency: { mode:
  // 'column' }` mapping that resolves no known code anywhere, including an
  // entirely blank column). `mappingIncomplete` below is what decides
  // whether THIS block shows `columnMapping.incomplete` for a `stats ===
  // undefined` render — a structurally complete mapping that merely failed
  // to apply has its own, more specific message elsewhere (the currency
  // field's error, or `noRowsResolvedError` below), so showing the generic
  // hint too would misname the real problem.
  stats: PreviewStats | undefined;
  rowErrors: ColumnMappingRowError[];
  // True while a required column/date-format is still unset — see `stats`'s
  // own doc comment above for what this gates.
  mappingIncomplete: boolean;
  // Every required field IS mapped, but literally zero rows resolved to a
  // transaction — whether because `applyColumnMapping` succeeded with none
  // (`stats` is defined at `transactionCount: 0`, and the itemized
  // `rowErrors` below explain the real, possibly mixed, per-row reasons) or
  // because it threw on a currency column with no data to read at all
  // (`stats` is `undefined`) — no single INPUT field is at fault either
  // way, so this renders on the Result block itself instead. Already gated
  // by the caller on the first Import press (`columnMapping.noRowsResolvedError`
  // translated), matching every other field's validate-on-press message —
  // `undefined` renders nothing.
  noRowsResolvedError?: string;
  // The chosen target holding's name, forwarded to `ExampleTransaction`'s
  // own `holdingName` prop — feeds its income/expense
  // default-title fallback. `undefined` before a holding is chosen.
  holdingName?: string;
  // What importing would leave the chosen holding's balance at
  // (`useImportBalancePreview`) — `undefined` before a holding is chosen or
  // while the read is out, which renders no line.
  balancePreview?: ImportBalancePreview;
};

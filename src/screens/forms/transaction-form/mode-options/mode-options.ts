import type { HoldingRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { isExchangeCreateSourceType } from '@kiko/holdings/exchange-destination';

// The mode row's options: Exchange is a CREATE-ONLY mode, offered only from a
// cash source on create (`isExchangeCreateSourceType`,
// narrower than the wider `isExchangeSourceType`/`isExchangeDestinationType`
// pair in `holdings/exchange-destination`, reserved for convert-mode) — an
// edit always opens on `income` or `expense` (no editing an already-recorded
// exchange here). Kept module-level for the same cognitive-complexity-budget
// reason as `buildExchangeOptions` (see `holding-options`).
export const resolveModeOptions = (
  isEditing: boolean,
  holding: Pick<HoldingRow, 'type'> | undefined,
): readonly FormMode[] => {
  const canExchange =
    !isEditing && holding !== undefined && isExchangeCreateSourceType(holding.type);

  // Split-change is offered from the SAME liquid-source create rule as Exchange
  // (a fresh manual create off a cash payer), so the two extra modes appear and
  // disappear together. Split is inherently an expense (the payment is negative)
  // and, like Exchange, never surfaces on an edit or a synced row.
  return canExchange ? ['income', 'expense', 'exchange', 'split'] : ['income', 'expense'];
};

// The SF Symbol shown for each transaction type (the select trigger's glyph
// and each sheet row's leading icon). Note the deliberate, spec-mandated
// asymmetry: expense points UP and income points DOWN (money leaving vs.
// arriving). `split`'s `arrow.trianglehead.branch` is an iOS 18 symbol (the
// deployment target is 18.2).
export const MODE_ICONS: Record<FormMode, string> = {
  income: 'arrow.down',
  expense: 'arrow.up',
  exchange: 'arrow.left.arrow.right',
  split: 'arrow.trianglehead.branch',
};

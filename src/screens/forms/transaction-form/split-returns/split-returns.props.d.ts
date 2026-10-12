import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import type { ChangeReturnRow } from '../row-labels';

export type SplitReturnsProps = {
  // Whether the split section renders at all — false collapses it to null, so
  // the screen's JSX gates on a single element (not its own `isSplit &&`),
  // keeping that branch out of the component's cognitive-complexity budget.
  visible: boolean;
  returns: readonly ChangeReturnRow[];
  buildOptions: (index: number) => HoldingSelectOption[];
  onSelectHolding: (index: number, holdingId: string) => void;
  onCreateHolding: () => void;
  onChangeAmount: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  // The payer holding's currency glyph, shown as every return amount's suffix
  // (v1 returns are payer-currency only).
  suffix: string;
  selectHoldingPlaceholder: string;
  t: TFunction;
  // The combined payment+returns validation-failure message, or `undefined`
  // when valid — rendered right after the mapped return rows, before the "Add
  // return" action, mirroring `TextField`'s own `error` contract even though
  // this reason covers the whole return list rather than one field. Every
  // return row's labels turn red with it, since it judges every row.
  error?: string;
  // The LAST return row's own wrapper ref — a SEPARATE ref from
  // `splitReturnsFieldRef` (the CALL SITE's own wrapper, anchoring the whole
  // section for scroll-to-invalid) — so `addReturn` can scroll to whichever
  // row is newest, via the SAME occlusion-aware `scrollToField` helper,
  // rather than an unconditional `scrollToEnd` that would fire even when
  // the new row was already fully visible. `undefined` is a valid value
  // (never passed while not split).
  lastRowRef?: RefObject<FieldInstance | null>;
};

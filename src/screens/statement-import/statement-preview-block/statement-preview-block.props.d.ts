import type { RefObject } from 'react';

import type { previewStats } from '../preview-stats/preview-stats';
import type { FieldInstance } from '../../forms/scroll-to-field/scroll-to-field';
import type { useTargetHoldingOptions } from '../use-target-holding-options/use-target-holding-options';

export type StatementPreviewBlockProps = {
  stats: ReturnType<typeof previewStats>;
  holdingOptions: ReturnType<typeof useTargetHoldingOptions>;
  accountId: string | undefined;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  // Import-press field-level error, `undefined` before the first press —
  // mirrors `column-mapping.screen.tsx`'s own validation model for the SAME
  // target-holding field.
  targetHoldingError: string | undefined;
  targetHoldingFieldRef: RefObject<FieldInstance | null>;
};

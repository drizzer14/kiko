import type { RefObject } from 'react';
import type { previewStats } from '@kiko/statement-import/preview-stats';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { TargetHoldingOption } from '@kiko/design-system/components/target-holding-sheet';

export type StatementPreviewBlockProps = {
  stats: ReturnType<typeof previewStats>;
  holdingOptions: TargetHoldingOption[];
  // Whether `holdingOptions` (and the account rows it joins each row's name
  // from) is still on its own first load — forwarded to `TargetHoldingField`
  // so the picker never opens on an incomplete/empty list while its own
  // queries are loading (kiko-architecture's useLiveQuery consumer rule).
  holdingOptionsLoading: boolean;
  accountId: string;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  // Import-press field-level error, `undefined` before the first press —
  // mirrors `column-mapping.screen.tsx`'s own validation model for the SAME
  // target-holding field.
  targetHoldingError: string | undefined;
  targetHoldingFieldRef: RefObject<FieldInstance | null>;
};

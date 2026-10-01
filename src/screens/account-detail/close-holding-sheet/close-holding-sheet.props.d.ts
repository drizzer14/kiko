import type { HoldingRow } from '@kiko/db';

/**
 * The Close confirm for a manual holding. `holding` outlives `visible`, so
 * the title keeps its name while the sheet animates out.
 */
export type CloseHoldingSheetProps = {
  holding: Pick<HoldingRow, 'id' | 'name'>;
  visible: boolean;
  onDismiss: () => void;
};

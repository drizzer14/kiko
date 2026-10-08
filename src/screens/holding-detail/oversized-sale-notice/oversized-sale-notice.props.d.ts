import type { HoldingRow } from '@kiko/db';

export type OversizedSaleNoticeProps = {
  // Undefined until the holding loads.
  holding: Pick<HoldingRow, 'type' | 'metadata'> | undefined;
};

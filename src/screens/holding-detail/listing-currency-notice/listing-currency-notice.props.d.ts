import type { HoldingRow } from '@kiko/db';

export type ListingCurrencyNoticeProps = {
  // Undefined until the holding loads.
  holding: Pick<HoldingRow, 'type' | 'currency' | 'metadata'> | undefined;
};

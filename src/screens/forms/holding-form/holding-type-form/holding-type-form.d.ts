import type { RefObject } from 'react';
import type { HoldingRow } from '@kiko/db/schema';
import type { Currency } from '@kiko/currency/currency';
import type { PriceBook } from '@kiko/prices/price-book';

import type { FieldInstance } from '../../scroll-to-field/scroll-to-field';

/** One validated field; the screen scrolls to the first invalid one, in this order. */
export type ScrollTarget = {
  invalid: boolean;
  ref: RefObject<FieldInstance | null>;
  focus?: () => void;
};

/** What `holdingsRepo.create` gets besides the identity fields. */
export type CreatePayload = {
  balanceMinorUnits: number;
  metadata: Record<string, unknown> | undefined;
  firstPricePoint?: { day: number; price: string };
};

export type EditContext = {
  holdingId: string;
  name: string;
  color: string | null;
  currency: Currency;
  isSynced: boolean;
  editingHolding: HoldingRow | undefined;
  book: PriceBook;
};

/** One holding type's form behaviour; the screen reads it through Record<HoldingType, HoldingTypeForm>. */
export type HoldingTypeForm = {
  /** Edit-mode hydration; a no-op for unparsable metadata. Must be a stable callback. */
  seed: (holding: HoldingRow) => void;
  isValid: boolean;
  /** Top to bottom; the screen prepends the name field. Built from per-field errors. */
  scrollTargets: readonly ScrollTarget[];
  /** The create write. `openingBalanceMinorUnits` keeps today's hidden-balance quirk for deposit/bond. */
  createPayload: (openingBalanceMinorUnits: number) => CreatePayload;
  /** The edit write, without the icon (the screen writes the icon). */
  saveEdit: (context: EditContext) => Promise<void>;
};

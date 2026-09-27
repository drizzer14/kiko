import type { RefObject } from 'react';
import type { HoldingRow } from '@kiko/db';
import type { Money } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import type { PriceBook } from '@kiko/prices/price-book';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

/** One validated field; the screen scrolls to the first invalid one, in this order. */
export type ScrollTarget = {
  invalid: boolean;
  ref: RefObject<FieldInstance | null>;
  focus?: () => void;
};

/**
 * What `holdingsRepo.create` gets besides the identity fields.
 * `openingBalance` is OMITTED (not zero-valued) for every ledgerless type —
 * `holdingsRepo.create` itself defaults an absent opening balance to 0.
 */
export type CreatePayload = {
  openingBalance?: Money;
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
  /**
   * The create write. A ledgerless type (property/metal/loan/deposit/bond)
   * always omits `openingBalance` (so `holdingsRepo.create` writes its
   * default of 0) — its value derives entirely from its own lots/schedule,
   * never a typed opening balance. Only `useBalanceFields`
   * (card/cash/crypto_asset/jar) reads its own live opening-balance field.
   */
  createPayload: () => CreatePayload;
  /** The edit write, without the icon (the screen writes the icon). */
  saveEdit: (context: EditContext) => Promise<void>;
};

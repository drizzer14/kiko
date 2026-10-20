import type { Money } from '@kiko/currency/money';

export type ConvertedCaptionProps = {
  // The figure in the base currency, or `null` when there is none to show.
  money: Money | null;
  testID: string;
};

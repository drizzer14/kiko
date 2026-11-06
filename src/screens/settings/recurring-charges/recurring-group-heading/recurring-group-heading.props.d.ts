import type { Money } from '@kiko/currency/money';

export type RecurringGroupHeadingProps = {
  title: string;
  icon: string;
  // The category's resolved color, already an effective hex.
  color: string;
  total: Money;
  testID: string;
  totalTestID: string;
};

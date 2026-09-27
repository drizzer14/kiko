import type { HoldingRow } from '@kiko/db';
import { Money } from '@kiko/currency/money';

export type HoldingValueBreakdown = {
  gross: Money;
  principalOrCost: Money;
  interest: Money;
  tax: Money;
  net: Money;
};

export const flat = (
  currency: HoldingRow['currency'],
  minorUnits: number,
): HoldingValueBreakdown => {
  const money = Money.of(currency, minorUnits);
  const zero = Money.of(currency, 0);

  return { gross: money, principalOrCost: money, interest: zero, tax: zero, net: money };
};

// Assembles a value breakdown from its minor-unit parts: gross = principal +
// interest, net = gross - tax. Shared by all three deposit branches so the
// gross/net arithmetic lives in exactly one place.
export const makeBreakdown = (
  currency: HoldingRow['currency'],
  principalMinor: number,
  interestMinor: number,
  taxMinor: number,
): HoldingValueBreakdown => {
  const grossMinor = principalMinor + interestMinor;

  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, principalMinor),
    interest: Money.of(currency, interestMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

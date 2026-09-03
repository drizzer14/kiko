import type { FC } from 'react';
import { formatMoney } from '../../../currency/format';
import Text from '../text';
import type { MoneyTextContext, MoneyTextProps, MoneyTextTone } from './money-text.props';

const isNegative = (minorUnits: number): boolean => minorUnits < 0;
const isPositive = (minorUnits: number): boolean => minorUnits > 0;

// The sign-only color rule: negative -> red, positive -> green, zero ->
// white. This is what an explicit `tone="neutral"` resolves to, and also
// what the default `context="transaction"` resolution falls back on below.
const signTone = (minorUnits: number) => {
  if (isNegative(minorUnits)) {
    return 'negative';
  }

  if (isPositive(minorUnits)) {
    return 'positive';
  }

  return 'textPrimary';
};

// Balances are a snapshot (white unless negative); only a transaction's
// positive movement earns the green "positive" tone. See money-text.props.ts
// for the full rule. An explicit `tone` prop short-circuits all of this: a
// caller that already knows the semantic color (tax always red, interest
// always green) supplies it directly instead of going through the
// context/sign resolution meant for a plain balance or transaction amount.
const resolveTone = (context: MoneyTextContext, minorUnits: number, tone?: MoneyTextTone) => {
  if (tone !== undefined) {
    return tone === 'neutral' ? signTone(minorUnits) : tone;
  }

  if (isNegative(minorUnits)) {
    return 'negative';
  }

  if (context === 'transaction' && isPositive(minorUnits)) {
    return 'positive';
  }

  return 'textPrimary';
};

const MoneyText: FC<MoneyTextProps> = ({ money, style, context = 'balance', tone }) => {
  const resolvedTone = resolveTone(context, money.minorUnits, tone);

  return (
    <Text variant="body" tone={resolvedTone} style={style}>
      {formatMoney(money)}
    </Text>
  );
};

export default MoneyText;

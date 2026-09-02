import type { FC } from 'react';
import { formatMoney } from '../../../currency/format';
import Text from '../text';
import type { MoneyTextContext, MoneyTextProps } from './money-text.props';

const isNegative = (minorUnits: number): boolean => minorUnits < 0;
const isPositive = (minorUnits: number): boolean => minorUnits > 0;

// Balances are a snapshot (white unless negative); only a transaction's
// positive movement earns the green "positive" tone. See money-text.props.ts
// for the full rule.
const resolveTone = (context: MoneyTextContext, minorUnits: number) => {
  if (isNegative(minorUnits)) {
    return 'negative';
  }

  if (context === 'transaction' && isPositive(minorUnits)) {
    return 'positive';
  }

  return 'textPrimary';
};

const MoneyText: FC<MoneyTextProps> = ({ money, style, context = 'balance' }) => {
  const tone = resolveTone(context, money.minorUnits);

  return (
    <Text variant="body" tone={tone} style={style}>
      {formatMoney(money)}
    </Text>
  );
};

export default MoneyText;

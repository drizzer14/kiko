import type { FC } from 'react';
import { formatMoney } from '../../currency/format';
import type { Money } from '../../currency/money';
import { Text } from './text';

export const MoneyText: FC<{ money: Money }> = ({ money }) => {
  const tone = money.minorUnits < 0 ? 'negative' : 'positive';
  return (
    <Text variant="body" tone={tone}>
      {formatMoney(money)}
    </Text>
  );
};

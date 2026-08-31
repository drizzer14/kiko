import type { FC } from 'react';
import { formatMoney } from '../../../currency/format';
import Text from '../text';
import type { MoneyTextProps } from './money-text.props';

const MoneyText: FC<MoneyTextProps> = ({ money }) => {
  const tone = money.minorUnits < 0 ? 'negative' : 'positive';

  return (
    <Text variant="body" tone={tone}>
      {formatMoney(money)}
    </Text>
  );
};

export default MoneyText;

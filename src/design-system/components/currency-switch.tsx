import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import type { Currency } from '../../currency/currency';
import { Box } from './box';
import { PressableButton } from './pressable-button';
import { Text } from './text';

const currencyOptions: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

type CurrencySwitchProps = {
  selected: Currency | undefined;
  onSelect: (currency: Currency) => void;
};

export const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  const { theme } = useUnistyles();

  return (
    <Box gap={2} style={{ flexDirection: 'row' }}>
      {currencyOptions.map(currency => (
        <PressableButton
          key={currency}
          onPress={() => onSelect(currency)}
          backgroundColor={selected === currency ? theme.colors.surfaceHigh : theme.colors.surface}
        >
          <Text variant="body" tone={selected === currency ? 'textPrimary' : 'textSecondary'}>
            {currency}
          </Text>
        </PressableButton>
      ))}
    </Box>
  );
};

import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../../currency/currency';
import Box from '../box';
import PressableButton from '../pressable-button';
import Text from '../text';
import type { CurrencySwitchProps } from './currency-switch.props';

const currencyOptions: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  const { theme } = useUnistyles();

  return (
    <Box gap={2} direction="row">
      {currencyOptions.map((currency) => (
        <PressableButton
          key={currency}
          onPress={() => onSelect(currency)}
          // Only the selected option paints a (raised) surface; the others stay
          // transparent so the glass card behind them shows through. Painting an
          // opaque fill on every pill made the Base Currency card read as a
          // solid gray block beside the plain-glass Categories card — leaving
          // the unselected pills transparent lets both cards share the one glass
          // surface treatment.
          backgroundColor={selected === currency ? theme.colors.surfaceHigh : 'transparent'}
        >
          <Text variant="body" tone={selected === currency ? 'textPrimary' : 'textSecondary'}>
            {currency}
          </Text>
        </PressableButton>
      ))}
    </Box>
  );
};

export default CurrencySwitch;

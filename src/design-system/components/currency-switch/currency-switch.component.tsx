import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { currencyOptions } from '../../../currency/currency';
import Box from '../box';
import Text from '../text';
import type { CurrencySwitchProps } from './currency-switch.props';
import { styles } from './currency-switch.styles';

// A segmented base-currency toggle, not an action button — so it stays a plain
// Pressable pill rather than the shared Button (which owns primary/secondary/
// destructive fills and would not fit a transparent, selected-state control).
const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  const { theme } = useUnistyles();

  return (
    <Box gap={2} direction="row">
      {currencyOptions.map((currency) => {
        const isSelected = selected === currency;

        return (
          <Pressable
            key={currency}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(currency)}
            // Only the selected option paints a (raised) surface; the others stay
            // transparent so the glass card behind them shows through. Painting an
            // opaque fill on every pill made the Base Currency card read as a
            // solid gray block beside the plain-glass Categories card — leaving
            // the unselected pills transparent lets both cards share the one glass
            // surface treatment.
            style={[
              styles.pill,
              { backgroundColor: isSelected ? theme.colors.surfaceHigh : 'transparent' },
            ]}
          >
            <Text variant="body" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
              {currency}
            </Text>
          </Pressable>
        );
      })}
    </Box>
  );
};

export default CurrencySwitch;

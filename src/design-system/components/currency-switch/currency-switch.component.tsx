import type { FC } from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { currencyOptions } from '../../../currency/currency';
import { currencySignSymbol } from '../../../currency/currency-symbols';
import Box from '../box';
import SymbolIcon from '../symbol';
import Text from '../text';
import type { CurrencySwitchProps } from './currency-switch.props';
import { styles } from './currency-switch.styles';

// A segmented base-currency toggle, not an action button — so it stays a plain
// Pressable pill rather than the shared Button (which owns primary/secondary/
// destructive fills and would not fit a transparent, selected-state control).
const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  const { theme } = useUnistyles();

  // A wrapping 2-column grid rather than a single row: each currency sits in
  // its own 50%-wide cell (styles.cell), so a 4th pill (or any further one, if
  // the option list ever grows) wraps onto a new row instead of squeezing the
  // row narrower. `gap` cannot pair with a raw `width: 50%` here — the two
  // halves plus a gap would overflow the row — so the grid's negative margin
  // and each cell's matching padding recreate the theme's spacing(2) gap in
  // both axes while keeping the outer edge flush.
  return (
    <Box style={styles.grid}>
      {currencyOptions.map((currency) => {
        const isSelected = selected === currency;

        return (
          <View key={currency} style={styles.cell}>
            <Pressable
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
              {/* The currency's SF Symbol sign glyph, tinted like ChipRow's option
                  icon so it reads on both the raised-selected and transparent
                  unselected pill. Kept inside the pill's icon+label row. */}
              <SymbolIcon
                name={currencySignSymbol[currency]}
                size={18}
                tone={isSelected ? 'textPrimary' : 'textSecondary'}
              />
              <Text variant="body" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
                {currency}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </Box>
  );
};

export default CurrencySwitch;

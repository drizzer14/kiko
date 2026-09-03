import { render } from '@testing-library/react-native';
import { Money } from '../../../currency/money';
import '../../../design-system/unistyles';
import { formatMoney } from '../../../currency/format';
import { darkTheme } from '../../../design-system/theme';
import type { EntryTone } from '../../../holdings/derived-entries';
import LedgerAmount from './ledger-amount.component';

// The test-renderer instance type, derived from RNTL's own query rather than
// imported from react-test-renderer directly (which is not a declared dep).
type TextNode = ReturnType<ReturnType<typeof render>['getByText']>;

// Flatten the amount Text's style array (typography tokens + the inline color)
// down to its resolved `color`, which is what these tests assert.
const colorOf = (node: TextNode): unknown => {
  const style = node.props.style as unknown;
  const parts = (Array.isArray(style) ? style : [style]).flat(Number.POSITIVE_INFINITY);
  return Object.assign({}, ...parts.filter(Boolean)).color;
};

const renderAmount = async (minorUnits: number, tone: EntryTone): Promise<TextNode> => {
  const money = Money.of('USD', minorUnits);
  const { getByText } = await render(<LedgerAmount money={money} tone={tone} />);
  return getByText(formatMoney(money));
};

describe('LedgerAmount', () => {
  it('renders a negative tone in the theme negative (red) color', async () => {
    expect(colorOf(await renderAmount(-15_781, 'negative'))).toBe(darkTheme.colors.negative);
  });

  it('renders a positive tone in the theme positive (green) color', async () => {
    expect(colorOf(await renderAmount(87_671, 'positive'))).toBe(darkTheme.colors.positive);
  });

  it('forces the negative color for a positive-signed amount when the tone is negative', async () => {
    // Tone wins over sign: a tax classified negative reads red even if its
    // amount happens to be stored positive.
    expect(colorOf(await renderAmount(1_000, 'negative'))).toBe(darkTheme.colors.negative);
  });

  it('colors a neutral tone by sign: money-in green', async () => {
    expect(colorOf(await renderAmount(50_000, 'neutral'))).toBe(darkTheme.colors.positive);
  });

  it('colors a neutral tone by sign: money-out red', async () => {
    expect(colorOf(await renderAmount(-50_000, 'neutral'))).toBe(darkTheme.colors.negative);
  });

  it('colors a neutral zero as primary text (white)', async () => {
    expect(colorOf(await renderAmount(0, 'neutral'))).toBe(darkTheme.colors.textPrimary);
  });
});

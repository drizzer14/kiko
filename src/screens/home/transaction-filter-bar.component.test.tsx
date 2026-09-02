import { fireEvent, type ReactTestInstance, render } from '@testing-library/react-native';
import { darkTheme } from '../../design-system/theme';
import '../../design-system/unistyles';
import TransactionFilterBar, { FILTER_ALL } from './transaction-filter-bar.component';

type BarProps = {
  selectedAccount?: Set<string>;
  selectedCategory?: Set<string>;
  onToggleAccount?: (value: string) => void;
  onToggleCategory?: (value: string) => void;
};

const renderBar = (props: BarProps = {}): ReturnType<typeof render> =>
  // This project's `render` resolves asynchronously (React 19 concurrent
  // rendering), so every call site awaits it before querying.
  render(
    <TransactionFilterBar
      accounts={['Monobank', 'PrivatBank']}
      categories={['Food', 'Transport']}
      selectedAccount={props.selectedAccount ?? new Set<string>()}
      selectedCategory={props.selectedCategory ?? new Set<string>()}
      onToggleAccount={props.onToggleAccount ?? jest.fn()}
      onToggleCategory={props.onToggleCategory ?? jest.fn()}
    />,
  );

// The chip's active state is expressed as the Pressable's backgroundColor
// token; the Text host is the sole child of that Pressable, so its parent is
// the button whose background reveals the active/inactive token.
const backgroundOf = (chip: ReactTestInstance): unknown => {
  const style = chip.parent?.props.style;
  const layers = Array.isArray(style) ? style : [style];
  const withBackground = layers.find(
    (layer): layer is { backgroundColor: unknown } =>
      layer != null && typeof layer === 'object' && 'backgroundColor' in layer,
  );

  return withBackground?.backgroundColor;
};

describe('TransactionFilterBar', () => {
  it('calls onToggleAccount with the option when a specific account chip is pressed', async () => {
    const onToggleAccount = jest.fn();
    const { getByText } = await renderBar({ onToggleAccount });

    fireEvent.press(getByText('PrivatBank'));

    expect(onToggleAccount).toHaveBeenCalledWith('PrivatBank');
  });

  it('calls onToggleAccount with FILTER_ALL when the All chip is pressed', async () => {
    const onToggleAccount = jest.fn();
    const { getAllByText } = await renderBar({ onToggleAccount });

    // The account row is rendered first, so its All chip is the first match.
    fireEvent.press(getAllByText(FILTER_ALL)[0]);

    expect(onToggleAccount).toHaveBeenCalledWith(FILTER_ALL);
  });

  it('calls onToggleCategory with the option when a specific category chip is pressed', async () => {
    const onToggleCategory = jest.fn();
    const { getByText } = await renderBar({ onToggleCategory });

    fireEvent.press(getByText('Transport'));

    expect(onToggleCategory).toHaveBeenCalledWith('Transport');
  });

  it('styles a chip active when it is in the selected set', async () => {
    const { getByText } = await renderBar({ selectedAccount: new Set(['Monobank']) });

    expect(backgroundOf(getByText('Monobank'))).toBe(darkTheme.colors.surfaceHigh);
    expect(backgroundOf(getByText('PrivatBank'))).toBe(darkTheme.colors.surface);
  });

  it('styles the All chip active when the set is empty', async () => {
    const { getAllByText } = await renderBar({ selectedAccount: new Set<string>() });

    expect(backgroundOf(getAllByText(FILTER_ALL)[0])).toBe(darkTheme.colors.surfaceHigh);
  });

  it('styles the All chip inactive when the set is non-empty', async () => {
    const { getAllByText } = await renderBar({ selectedAccount: new Set(['Monobank']) });

    expect(backgroundOf(getAllByText(FILTER_ALL)[0])).toBe(darkTheme.colors.surface);
  });
});

import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Money } from '../../../currency/money';
import '../../unistyles';
import MoneyText from './money-text.component';

// The Text primitive's tone -> color mapping lives inside a
// react-native-unistyles variant, which the project's Jest mock
// (react-native-unistyles/mocks, registered in jest/setup.js) strips out of
// the resolved style object before a test can ever inspect it. Mock Text
// here instead, exposing the `tone` prop MoneyText resolves via a testID —
// the money amount itself still renders as plain text underneath, so the
// existing formatted-amount assertion below is unaffected.
jest.mock('../text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone: string; children: ReactNode }) => (
      <RNText testID={`money-text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

// Render MoneyText with the given amount + context and assert the resolved
// tone the mocked Text exposes via its testID.
const expectTone = async (
  minorUnits: number,
  context: 'balance' | 'transaction' | undefined,
  tone: string,
): Promise<void> => {
  const { getByTestId } = await render(
    <MoneyText money={Money.of('USD', minorUnits)} context={context} />,
  );
  expect(getByTestId(`money-text-tone-${tone}`)).toBeTruthy();
};

describe('MoneyText', () => {
  it('renders the formatted amount', async () => {
    const { getByText } = await render(<MoneyText money={Money.of('USD', 123456)} />);
    expect(getByText(/\$1,234\.56/)).toBeTruthy();
  });

  it('renders a positive balance as textPrimary (white), not positive (green)', async () => {
    await expectTone(123456, 'balance', 'textPrimary');
  });

  it('renders a negative balance as negative (red)', async () => {
    await expectTone(-123456, 'balance', 'negative');
  });

  it('renders a zero balance as textPrimary (white)', async () => {
    await expectTone(0, 'balance', 'textPrimary');
  });

  it('renders a positive transaction as positive (green)', async () => {
    await expectTone(123456, 'transaction', 'positive');
  });

  it('renders a negative transaction as negative (red)', async () => {
    await expectTone(-123456, 'transaction', 'negative');
  });

  it('renders a zero transaction as textPrimary (white)', async () => {
    await expectTone(0, 'transaction', 'textPrimary');
  });

  it('defaults to balance context when none is given (positive stays textPrimary)', async () => {
    await expectTone(123456, undefined, 'textPrimary');
  });

  it('renders a positive amount as negative (red) when tone="negative" overrides it', async () => {
    const { getByTestId } = await render(
      <MoneyText money={Money.of('USD', 123456)} context="balance" tone="negative" />,
    );
    expect(getByTestId('money-text-tone-negative')).toBeTruthy();
  });

  it('renders a negative amount as positive (green) when tone="positive" overrides it', async () => {
    const { getByTestId } = await render(
      <MoneyText money={Money.of('USD', -123456)} context="transaction" tone="positive" />,
    );
    expect(getByTestId('money-text-tone-positive')).toBeTruthy();
  });

  it('colors tone="neutral" by sign regardless of context (positive -> green)', async () => {
    const { getByTestId } = await render(
      <MoneyText money={Money.of('USD', 123456)} context="balance" tone="neutral" />,
    );
    expect(getByTestId('money-text-tone-positive')).toBeTruthy();
  });

  it('colors tone="neutral" by sign regardless of context (negative -> red)', async () => {
    const { getByTestId } = await render(
      <MoneyText money={Money.of('USD', -123456)} context="balance" tone="neutral" />,
    );
    expect(getByTestId('money-text-tone-negative')).toBeTruthy();
  });

  it('colors tone="neutral" zero as textPrimary (white)', async () => {
    const { getByTestId } = await render(
      <MoneyText money={Money.of('USD', 0)} context="transaction" tone="neutral" />,
    );
    expect(getByTestId('money-text-tone-textPrimary')).toBeTruthy();
  });
});

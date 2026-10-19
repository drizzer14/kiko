import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { Money } from '@kiko/currency/money';

import ConvertedCaption from '.';

// The jest unistyles mock strips the variant and tone styles `Text` resolves, so a passthrough
// that forwards both props onto the host node is the only way to read them.
jest.mock('@kiko/design-system/components/text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({
    children,
    tone,
    variant,
  }: {
    children: React.ReactNode;
    tone?: string;
    variant?: string;
  }) => React.createElement(RNText, { tone, variant }, children);

  return { __esModule: true, default: MockText };
});

describe('ConvertedCaption', () => {
  it('renders nothing for a null value', async () => {
    const { queryByTestId } = await render(<ConvertedCaption money={null} testID="caption" />);

    expect(queryByTestId('caption')).toBeNull();
  });

  it('renders the formatted money under the test id', async () => {
    const { getByTestId, getByText } = await render(
      <ConvertedCaption money={Money.of('UAH', 440_000)} testID="caption" />,
    );

    expect(getByTestId('caption')).toBeTruthy();
    expect(getByText(/4,400\.00 ₴/)).toBeTruthy();
  });

  it('draws the text in the caption variant and the secondary tone', async () => {
    const { getByText } = await render(
      <ConvertedCaption money={Money.of('UAH', 440_000)} testID="caption" />,
    );

    expect(getByText(/4,400\.00 ₴/).props).toMatchObject({
      variant: 'caption',
      tone: 'textSecondary',
    });
  });
});

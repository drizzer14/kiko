import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { Money } from '@kiko/currency/money';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import ConvertedCaption from '.';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

describe('ConvertedCaption', () => {
  it('renders nothing for a null value', async () => {
    const { queryByTestId } = await render(<ConvertedCaption money={null} testID="caption" />);

    expect(queryByTestId('caption')).toBeNull();
  });

  it('renders the formatted money under the test id', async () => {
    const { getByTestId } = await render(
      <ConvertedCaption money={Money.of('UAH', 440_000)} testID="caption" />,
    );

    expect(within(getByTestId('caption')).getByText(/4,400\.00 ₴/)).toBeTruthy();
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

import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';

import EditHeaderButton from './edit-header-button.component';

// Button's SF Symbol icon is mocked the same way button.component.test.tsx
// mocks it, so the pencil glyph is queryable without the native SFSymbolView.
jest.mock('@kiko/design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

describe('EditHeaderButton', () => {
  it('renders the pencil glyph with no visible "Edit" text', async () => {
    const { getByText, queryByText } = await render(<EditHeaderButton onPress={jest.fn()} />);

    expect(getByText('icon:pencil')).toBeTruthy();
    expect(queryByText('Edit')).toBeNull();
  });

  it('keeps the 44pt HIG minimum touch height', async () => {
    const { getByLabelText } = await render(<EditHeaderButton onPress={jest.fn()} />);

    expect(StyleSheet.flatten(getByLabelText('Edit').props.style).minHeight).toBe(44);
  });

  // An icon-only button has no label to widen it, so its width is only the
  // padding either side of the glyph and must reach 44pt on its own.
  it('keeps the 44pt HIG minimum touch width', async () => {
    const { getByLabelText } = await render(<EditHeaderButton onPress={jest.fn()} />);
    const { paddingHorizontal } = StyleSheet.flatten(getByLabelText('Edit').props.style);

    expect(typeof paddingHorizontal).toBe('number');
    expect(Number(paddingHorizontal) * 2 + darkTheme.iconSizes.body).toBeGreaterThanOrEqual(44);
  });

  it('fires onPress when the button is tapped', async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(<EditHeaderButton onPress={onPress} />);

    await fireEvent.press(getByLabelText('Edit'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('speaks the Ukrainian catalog label when the locale is uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, queryByText } = await render(
        <EditHeaderButton onPress={jest.fn()} />,
      );

      expect(getByLabelText('Редагувати')).toBeTruthy();
      expect(queryByText('Редагувати')).toBeNull();
    });
  });
});

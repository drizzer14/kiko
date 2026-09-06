import { act, fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { i18n } from '../../i18n';

import EditHeaderButton from './edit-header-button.component';

// Button's SF Symbol icon is mocked the same way button.component.test.tsx
// mocks it, so the leading pencil glyph is queryable without the native
// SFSymbolView.
jest.mock('../../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

describe('EditHeaderButton', () => {
  it('renders the "Edit" label with a leading pencil icon', async () => {
    const { getByText } = await render(<EditHeaderButton onPress={jest.fn()} />);

    expect(getByText('Edit')).toBeTruthy();
    expect(getByText('icon:pencil')).toBeTruthy();
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

    it('renders the Ukrainian catalog label when the locale is uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByText, getByLabelText } = await render(<EditHeaderButton onPress={jest.fn()} />);

      expect(getByText('Редагувати')).toBeTruthy();
      expect(getByLabelText('Редагувати')).toBeTruthy();
    });
  });
});

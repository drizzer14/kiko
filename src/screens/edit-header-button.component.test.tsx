import { fireEvent, render } from '@testing-library/react-native';
import '../design-system/unistyles';
import EditHeaderButton from './edit-header-button.component';

// Button's SF Symbol icon is mocked the same way button.component.test.tsx
// mocks it, so the trailing pencil glyph is queryable without the native
// SFSymbolView.
jest.mock('../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

describe('EditHeaderButton', () => {
  it('renders the "Edit" label with a trailing pencil icon', async () => {
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
});

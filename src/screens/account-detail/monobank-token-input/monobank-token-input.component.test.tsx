import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import MonobankTokenInput from './monobank-token-input.component';

const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

describe('MonobankTokenInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the API link, the token field, and the paste-icon button', async () => {
    const { getByText, getByPlaceholderText, getByLabelText } = await render(
      <MonobankTokenInput value="" onChangeText={jest.fn()} />,
    );

    expect(getByText('Open api.monobank.ua')).toBeTruthy();
    expect(getByPlaceholderText('Monobank token')).toBeTruthy();
    expect(getByLabelText('Paste from clipboard')).toBeTruthy();
  });

  it('shows the controlled value in the field', async () => {
    const { getByPlaceholderText } = await render(
      <MonobankTokenInput value="controlled-token" onChangeText={jest.fn()} />,
    );

    expect(getByPlaceholderText('Monobank token').props.value).toBe('controlled-token');
  });

  it('opens api.monobank.ua when the link is pressed', async () => {
    const { getByText } = await render(<MonobankTokenInput value="" onChangeText={jest.fn()} />);

    await fireEvent.press(getByText('Open api.monobank.ua'));

    expect(mockOpenURL).toHaveBeenCalledWith('https://api.monobank.ua/');
  });

  it('emits a trimmed clipboard value through onChangeText when the paste icon is pressed', async () => {
    mockGetString.mockResolvedValue('  clipboard-token\n');
    const onChangeText = jest.fn();
    const { getByLabelText } = await render(
      <MonobankTokenInput value="" onChangeText={onChangeText} />,
    );

    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });

    expect(onChangeText).toHaveBeenCalledWith('clipboard-token');
  });

  it('emits typed text through onChangeText', async () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <MonobankTokenInput value="" onChangeText={onChangeText} />,
    );

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'typed');

    expect(onChangeText).toHaveBeenCalledWith('typed');
  });
});

describe('MonobankTokenInput — localization', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the link and placeholder from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText, getByPlaceholderText } = await render(
      <MonobankTokenInput value="" onChangeText={jest.fn()} />,
    );

    expect(getByText('Відкрити api.monobank.ua')).toBeTruthy();
    expect(getByPlaceholderText('Токен Monobank')).toBeTruthy();
  });
});

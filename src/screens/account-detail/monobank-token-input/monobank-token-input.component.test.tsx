import type { ReactNode } from 'react';
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

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// Mock Text here — following the account-detail screen test precedent — so the
// resolved `tone` the link renders with is observable via a testID, while the
// label still renders as plain text so every getByText assertion is unaffected.
jest.mock('../../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

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

  it('uses the Kiko UI clipboard glyph for the paste button', async () => {
    const { root } = await render(<MonobankTokenInput value="" onChangeText={jest.fn()} />);

    // The paste button carries the Kiko UI `document.on.clipboard` spelling
    // (SFSymbolView forwards `name` as a host prop).
    expect(
      (root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
    ).toBeGreaterThan(0);
  });

  it('shows the controlled value in the field', async () => {
    const { getByPlaceholderText } = await render(
      <MonobankTokenInput value="controlled-token" onChangeText={jest.fn()} />,
    );

    expect(getByPlaceholderText('Monobank token').props.value).toBe('controlled-token');
  });

  it('renders the API link through the shared Text primitive with the accent tone', async () => {
    const { getByText } = await render(<MonobankTokenInput value="" onChangeText={jest.fn()} />);

    // The link reads as a tappable inline label via the shared `Text` tone
    // token, matching the pie legend's "Show all" toggle, rather than an
    // inline-styled raw RN `Text`.
    expect(getByText('Open api.monobank.ua').props.testID).toBe('text-tone-accent');
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

  it('shows the Keychain-only data-handling disclosure as a secondary caption', async () => {
    const { getByText } = await render(<MonobankTokenInput value="" onChangeText={jest.fn()} />);

    const disclosure = getByText(
      "Your token is stored only in your device's Keychain, used only to fetch your own data directly from Monobank, and is never sent to Kiko or any server.",
    );

    expect(disclosure).toBeTruthy();
    expect(disclosure.props.testID).toBe('text-tone-textSecondary');
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

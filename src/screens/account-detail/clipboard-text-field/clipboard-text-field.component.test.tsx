import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import ClipboardTextField from '.';

const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

describe('ClipboardTextField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the labeled field and the paste-icon button', async () => {
    const { getByText, getByPlaceholderText, getByLabelText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(getByText('Token')).toBeTruthy();
    expect(getByPlaceholderText('Monobank token')).toBeTruthy();
    expect(getByLabelText('Paste from clipboard')).toBeTruthy();
  });

  it('uses the Kiko UI clipboard glyph for the paste button', async () => {
    const { root } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(
      (root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
    ).toBeGreaterThan(0);
  });

  it('shows the controlled value in the field', async () => {
    const { getByPlaceholderText } = await render(
      <ClipboardTextField
        label="Token"
        value="controlled-value"
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(getByPlaceholderText('Monobank token').props.value).toBe('controlled-value');
  });

  it('defaults to a non-secure field when secureTextEntry is omitted', async () => {
    const { getByPlaceholderText } = await render(
      <ClipboardTextField
        label="Address"
        value=""
        onChangeText={jest.fn()}
        placeholder="BTC address"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(getByPlaceholderText('BTC address').props.secureTextEntry).toBeFalsy();
  });

  it('renders a secure field when secureTextEntry is passed', async () => {
    const { getByPlaceholderText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
        secureTextEntry
      />,
    );

    expect(getByPlaceholderText('Monobank token').props.secureTextEntry).toBe(true);
  });

  it('emits a trimmed clipboard value through onChangeText when the paste icon is pressed', async () => {
    mockGetString.mockResolvedValue('  clipboard-value\n');
    const onChangeText = jest.fn();
    const { getByLabelText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={onChangeText}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });

    expect(onChangeText).toHaveBeenCalledWith('clipboard-value');
  });

  it('emits typed text through onChangeText', async () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={onChangeText}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'typed');

    expect(onChangeText).toHaveBeenCalledWith('typed');
  });
});

import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '@kiko/i18n/init';

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

  // The caption now renders through a standalone `FieldLabel` ABOVE the
  // [input, button] row (see the component's own doc comment for why), so
  // `TextField` itself is called with no `label` prop any more — its own
  // `accessibilityLabel` default (`= label`, text-field.component.tsx) would
  // otherwise silently resolve to `undefined`. This locks in that the input's
  // accessible name still resolves to the field's label regardless.
  it("preserves the input's accessible name as the field label even though TextField itself renders no caption", async () => {
    const { getByLabelText, getByPlaceholderText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(getByLabelText('Token')).toBe(getByPlaceholderText('Monobank token'));
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

  it('renders no error message when error is omitted', async () => {
    const { queryByText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    expect(queryByText('Enter your Monobank token.')).toBeNull();
  });

  it('shows the FieldError message under the field when error is set', async () => {
    const { getByText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
        error="Enter your Monobank token."
      />,
    );

    expect(getByText('Enter your Monobank token.')).toBeTruthy();
  });

  // The paste glyph sits close to the input and to the row's end — a compact
  // icon-button spacing — while the Button keeps its own 44pt-wide tap target:
  // the row gap is 4pt, and the wrapper's -4pt horizontal margin pulls the
  // button's 12pt padding in, so the glyph sits 12pt from the input and 8pt
  // from the row's end, and the tap target still starts at the input's edge.
  it('spaces the paste glyph compactly: a 4pt row gap and a -4pt wrapper margin', async () => {
    const { getByLabelText } = await render(
      <ClipboardTextField
        label="Token"
        value=""
        onChangeText={jest.fn()}
        placeholder="Monobank token"
        pasteAccessibilityLabel="Paste from clipboard"
      />,
    );

    const styledAncestors: Record<string, unknown>[] = [];
    let node = getByLabelText('Paste from clipboard').parent;

    while (node !== null && styledAncestors.length < 2) {
      if (typeof node.type === 'string' && node.props.style !== undefined) {
        styledAncestors.push(StyleSheet.flatten(node.props.style));
      }

      node = node.parent;
    }

    const [wrapperStyle, rowStyle] = styledAncestors;
    expect(wrapperStyle.marginHorizontal).toBe(-4);
    expect(rowStyle.gap).toBe(4);
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

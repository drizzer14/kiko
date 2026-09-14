import { fireEvent, render } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import '../../../i18n';
import '../../unistyles';
import TextField from '.';

describe('TextField', () => {
  it('renders its label as a caption and the value in the input', async () => {
    const { getByText, getByDisplayValue } = await render(
      <TextField label="Token" value="abc123" onChangeText={jest.fn()} />,
    );

    expect(getByText('Token')).toBeTruthy();
    expect(getByDisplayValue('abc123')).toBeTruthy();
  });

  it('forwards secureTextEntry to the input so a secret field is masked', async () => {
    const { getByLabelText } = await render(
      <TextField label="Token" value="secret" onChangeText={jest.fn()} secureTextEntry />,
    );

    expect(getByLabelText('Token').props.secureTextEntry).toBe(true);
  });

  it('defaults secureTextEntry off for an ordinary field', async () => {
    const { getByLabelText } = await render(
      <TextField label="Name" value="Jane" onChangeText={jest.fn()} />,
    );

    // Undefined (never masked) unless the caller opts in.
    expect(getByLabelText('Name').props.secureTextEntry).toBeUndefined();
  });

  it('renders a trailing suffix after the input', async () => {
    const { getByText, getByDisplayValue } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} suffix="₴" />,
    );

    // The value stays in the input; the currency glyph shows alongside it.
    expect(getByDisplayValue('100.00')).toBeTruthy();
    expect(getByText('₴')).toBeTruthy();
  });

  it('renders no suffix by default', async () => {
    const { queryByText } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} />,
    );

    expect(queryByText('₴')).toBeNull();
  });

  it('treats an empty suffix as no suffix', async () => {
    const { queryByText } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} suffix="" />,
    );

    // An empty suffix (a currency not yet known) renders exactly as the
    // no-suffix field — no stray trailing node.
    expect(queryByText('')).toBeNull();
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <TextField label="Amount" value="" onChangeText={jest.fn()} required />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders a Done accessory for a numeric (decimal-pad) field on iOS', async () => {
    const { getByText } = await render(
      <TextField
        label="Amount"
        value="100.00"
        onChangeText={jest.fn()}
        keyboardType="decimal-pad"
      />,
    );

    expect(getByText('Done')).toBeTruthy();
  });

  it('renders a Done accessory for a numeric (number-pad) field on iOS', async () => {
    const { getByText } = await render(
      <TextField label="Amount" value="100" onChangeText={jest.fn()} keyboardType="number-pad" />,
    );

    expect(getByText('Done')).toBeTruthy();
  });

  it('renders a Done accessory for a default (text) field too', async () => {
    // The native Done accessory is unconditional on iOS — every input carries
    // it, text and numeric alike, so the whole app shows one identical Done.
    const { getByText } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} />,
    );

    expect(getByText('Done')).toBeTruthy();
  });

  it('dismisses the keyboard when the Done accessory is pressed', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

    const { getByText } = await render(
      <TextField
        label="Amount"
        value="100.00"
        onChangeText={jest.fn()}
        keyboardType="decimal-pad"
      />,
    );

    fireEvent.press(getByText('Done'));

    expect(dismissSpy).toHaveBeenCalledTimes(1);

    dismissSpy.mockRestore();
  });

  it("defaults a text field's return key to Done", async () => {
    const { getByLabelText } = await render(
      <TextField label="Name" value="Jane" onChangeText={jest.fn()} />,
    );

    expect(getByLabelText('Name').props.returnKeyType).toBe('done');
  });

  it('does not override a caller-provided returnKeyType', async () => {
    const { getByLabelText } = await render(
      <TextField label="Search" value="q" onChangeText={jest.fn()} returnKeyType="search" />,
    );

    expect(getByLabelText('Search').props.returnKeyType).toBe('search');
  });

  it('forwards the optional onBlur onto the underlying input and fires it on blur', async () => {
    const onBlur = jest.fn();
    const { getByLabelText } = await render(
      <TextField label="Name" value="Jane" onChangeText={jest.fn()} onBlur={onBlur} />,
    );

    // Assert on the HOST input's own prop, not fireEvent(el, 'blur'): RNTL's
    // fireEvent walks up the fiber tree and would invoke TextField's OWN prop
    // even if it never reached the TextInput, masking a missing passthrough.
    const input = getByLabelText('Name');
    expect(input.props.onBlur).toBeDefined();
    input.props.onBlur();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('leaves the underlying input without an onBlur when omitted', async () => {
    const { getByLabelText } = await render(
      <TextField label="Name" value="Jane" onChangeText={jest.fn()} />,
    );

    // The passthrough is optional, so an unspecified onBlur is undefined on the
    // input — every existing caller stays unaffected.
    expect(getByLabelText('Name').props.onBlur).toBeUndefined();
  });

  it('leaves a return-keyless numeric field without a returnKeyType default', async () => {
    const { getByLabelText } = await render(
      <TextField label="Amount" value="1" onChangeText={jest.fn()} keyboardType="decimal-pad" />,
    );

    // A decimal-pad keyboard has no return key, so there is nothing to label —
    // its dismissal affordance is the InputAccessoryView Done instead.
    expect(getByLabelText('Amount').props.returnKeyType).toBeUndefined();
  });
});

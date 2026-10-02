import type { ComponentProps } from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';
import TextField from '.';

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

// Every test below renders the same TextField shape with only a couple of
// props varying (a label, a value, and whichever prop is under test), so this
// shared helper carries the two props every render needs — `value` and
// `onChangeText` — letting each test state only what it actually varies
// instead of repeating the same render boilerplate call after call.
const renderField = (props: Partial<ComponentProps<typeof TextField>> = {}) =>
  render(<TextField value="" onChangeText={jest.fn()} {...props} />);

describe('TextField', () => {
  it('renders its label as a caption and the value in the input', async () => {
    const { getByText, getByDisplayValue } = await renderField({
      label: 'Token',
      value: 'abc123',
    });

    expect(getByText('Token')).toBeTruthy();
    expect(getByDisplayValue('abc123')).toBeTruthy();
  });

  it('forwards secureTextEntry to the input so a secret field is masked', async () => {
    const { getByLabelText } = await renderField({
      label: 'Token',
      value: 'secret',
      secureTextEntry: true,
    });

    expect(getByLabelText('Token').props.secureTextEntry).toBe(true);
  });

  it('defaults secureTextEntry off for an ordinary field', async () => {
    const { getByLabelText } = await renderField({ label: 'Name', value: 'Jane' });

    // Undefined (never masked) unless the caller opts in.
    expect(getByLabelText('Name').props.secureTextEntry).toBeUndefined();
  });

  it('renders a leading SF Symbol icon before the input when leadingIcon is set', async () => {
    const { toJSON, getByDisplayValue } = await renderField({
      label: 'Search',
      value: 'usd',
      leadingIcon: 'magnifyingglass',
    });

    // The input still holds the value, and the leading glyph renders before it.
    // The mocked SFSymbolView forwards its `name` to a host View, so the symbol
    // name appears in the tree.
    expect(getByDisplayValue('usd')).toBeTruthy();
    expect(JSON.stringify(toJSON())).toContain('magnifyingglass');
  });

  it('renders no leading icon by default', async () => {
    const { toJSON } = await renderField({ label: 'Name', value: 'Jane' });

    expect(JSON.stringify(toJSON())).not.toContain('magnifyingglass');
  });

  it('renders a trailing suffix after the input', async () => {
    const { getByText, getByDisplayValue } = await renderField({
      label: 'Amount',
      value: '100.00',
      suffix: '₴',
    });

    // The value stays in the input; the currency glyph shows alongside it.
    expect(getByDisplayValue('100.00')).toBeTruthy();
    expect(getByText('₴')).toBeTruthy();
  });

  it('renders no suffix by default', async () => {
    const { queryByText } = await renderField({ label: 'Amount', value: '100.00' });

    expect(queryByText('₴')).toBeNull();
  });

  it('treats an empty suffix as no suffix', async () => {
    const { queryByText } = await renderField({ label: 'Amount', value: '100.00', suffix: '' });

    // An empty suffix (a currency not yet known) renders exactly as the
    // no-suffix field — no stray trailing node.
    expect(queryByText('')).toBeNull();
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await renderField({ label: 'Amount', value: '', required: true });

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders a Done accessory for a numeric (decimal-pad) field on iOS', async () => {
    const { getByText } = await renderField({
      label: 'Amount',
      value: '100.00',
      keyboardType: 'decimal-pad',
    });

    expect(getByText('Done')).toBeTruthy();
  });

  it('renders a Done accessory for a numeric (number-pad) field on iOS', async () => {
    const { getByText } = await renderField({
      label: 'Amount',
      value: '100',
      keyboardType: 'number-pad',
    });

    expect(getByText('Done')).toBeTruthy();
  });

  it('renders a Done accessory for a default (text) field too', async () => {
    // The native Done accessory is unconditional on iOS — every input carries
    // it, text and numeric alike, so the whole app shows one identical Done.
    const { getByText } = await renderField({ label: 'Amount', value: '100.00' });

    expect(getByText('Done')).toBeTruthy();
  });

  it('dismisses the keyboard when the Done accessory is pressed', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

    const { getByText } = await renderField({
      label: 'Amount',
      value: '100.00',
      keyboardType: 'decimal-pad',
    });

    await fireEvent.press(getByText('Done'));

    expect(dismissSpy).toHaveBeenCalledTimes(1);

    dismissSpy.mockRestore();
  });

  it("defaults a text field's return key to Done", async () => {
    const { getByLabelText } = await renderField({ label: 'Name', value: 'Jane' });

    expect(getByLabelText('Name').props.returnKeyType).toBe('done');
  });

  it('does not override a caller-provided returnKeyType', async () => {
    const { getByLabelText } = await renderField({
      label: 'Search',
      value: 'q',
      returnKeyType: 'search',
    });

    expect(getByLabelText('Search').props.returnKeyType).toBe('search');
  });

  it('forwards the optional onBlur onto the underlying input and fires it on blur', async () => {
    const onBlur = jest.fn();
    const { getByLabelText } = await renderField({ label: 'Name', value: 'Jane', onBlur });

    // Assert on the HOST input's own prop, not fireEvent(el, 'blur'): RNTL's
    // fireEvent walks up the fiber tree and would invoke TextField's OWN prop
    // even if it never reached the TextInput, masking a missing passthrough.
    const input = getByLabelText('Name');
    expect(input.props.onBlur).toBeDefined();
    input.props.onBlur();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('leaves the underlying input without an onBlur when omitted', async () => {
    const { getByLabelText } = await renderField({ label: 'Name', value: 'Jane' });

    // The passthrough is optional, so an unspecified onBlur is undefined on the
    // input — every existing caller stays unaffected.
    expect(getByLabelText('Name').props.onBlur).toBeUndefined();
  });

  it('leaves a return-keyless numeric field without a returnKeyType default', async () => {
    const { getByLabelText } = await renderField({
      label: 'Amount',
      value: '1',
      keyboardType: 'decimal-pad',
    });

    // A decimal-pad keyboard has no return key, so there is nothing to label —
    // its dismissal affordance is the InputAccessoryView Done instead.
    expect(getByLabelText('Amount').props.returnKeyType).toBeUndefined();
  });

  it('keeps the fixed 44pt height for an ordinary (non-multiline) field', async () => {
    const { getByLabelText } = await renderField({ label: 'Name', value: 'Jane' });

    const flatStyle = StyleSheet.flatten(getByLabelText('Name').props.style);
    expect(flatStyle.height).toBe(44);
    expect(flatStyle.minHeight).toBeUndefined();
    expect(flatStyle.textAlignVertical).toBeUndefined();
  });

  it('grows a multiline field to fit its content instead of clipping to the fixed height', async () => {
    const { getByLabelText } = await renderField({
      label: 'Encryption Key',
      value: 'a-very-long-forty-four-character-base64-key',
      multiline: true,
    });

    const input = getByLabelText('Encryption Key');
    expect(input.props.multiline).toBe(true);

    const flatStyle = StyleSheet.flatten(input.props.style);
    // No fixed height — the field grows with its content — but a 44pt
    // minHeight floor keeps the same minimum tap target, and the text
    // starts at the top edge rather than vertically centering.
    expect(flatStyle.height).toBeUndefined();
    expect(flatStyle.minHeight).toBe(44);
    expect(flatStyle.textAlignVertical).toBe('top');
  });

  it('renders no error styling or message by default', async () => {
    const { queryByText, getByLabelText } = await renderField({ label: 'Amount', value: '' });

    // The reflow error model: no per-field outline, ever — see
    // text-field.component.tsx.
    const flatStyle = StyleSheet.flatten(getByLabelText('Amount').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
    expect(queryByText('Enter an amount greater than 0.')).toBeNull();
  });

  it('never applies a border for an invalid field (Option A: no outline) and renders the message directly under the input', async () => {
    const { getByLabelText, getByText } = await renderField({
      label: 'Amount',
      value: '',
      error: 'Enter an amount greater than 0.',
    });

    const flatStyle = StyleSheet.flatten(getByLabelText('Amount').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
    expect(getByText('Enter an amount greater than 0.')).toBeTruthy();
  });

  it('reflows rather than reserves: no error node renders at all while the field is valid', async () => {
    const { queryByTestId } = await renderField({
      label: 'Amount',
      value: '',
      testID: 'amount-field',
    });

    expect(queryByTestId('amount-field-error')).toBeNull();
  });

  it('mounts the error node the instant the field becomes invalid, with no reserved slot beforehand', async () => {
    const { getByTestId, queryByTestId, rerender } = await renderField({
      label: 'Amount',
      value: '',
      testID: 'amount-field',
    });

    expect(queryByTestId('amount-field-error')).toBeNull();

    await rerender(
      <TextField
        label="Amount"
        value=""
        onChangeText={jest.fn()}
        testID="amount-field"
        error="Enter an amount greater than 0."
      />,
    );

    expect(getByTestId('amount-field-error')).toBeTruthy();
  });

  it('forwards testID to the outer field and derives the error testID from it', async () => {
    const { getByTestId } = await renderField({
      label: 'Amount',
      value: '',
      testID: 'amount-field',
      error: 'Enter an amount greater than 0.',
    });

    expect(getByTestId('amount-field')).toBeTruthy();
    expect(getByTestId('amount-field-error')).toBeTruthy();
  });

  it('tints the label negative when `error` is set', async () => {
    await renderField({ label: 'Amount', value: '', error: 'Enter an amount greater than 0.' });

    expect(isLabelInvalid(mockFieldLabel, 'Amount')).toBe(true);
  });

  it('tints the label negative with no error line of its own when `invalid` is set', async () => {
    const { queryByTestId } = await renderField({
      label: 'Return 1',
      value: '',
      testID: 'return-field',
      invalid: true,
    });

    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(true);
    expect(queryByTestId('return-field-error')).toBeNull();
  });

  it('forwards inputRef to the underlying TextInput so a caller can focus it imperatively', async () => {
    const inputRef: ComponentProps<typeof TextField>['inputRef'] = { current: null };
    await renderField({ label: 'Amount', value: '', inputRef });

    expect(inputRef.current).not.toBeNull();
    expect(typeof inputRef.current?.focus).toBe('function');
  });
});

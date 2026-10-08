import type { ReactNode } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import FieldTrigger from '.';

// Text's tone -> color mapping is a react-native-unistyles variant, which
// this project's Jest setup cannot resolve back out of a rendered style —
// mock Text to surface its `tone` prop through a testID instead, the same
// pattern `field-label.component.test.tsx` uses. Children still render as
// plain text, so every other query in this file is unaffected.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

describe('FieldTrigger', () => {
  it('renders the label and value and reports a press', async () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = await render(
      <FieldTrigger label="Category" onPress={onPress} value="Groceries" valueTone="textPrimary" />,
    );

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();

    await fireEvent.press(getByLabelText('Category'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Select a category"
        valueTone="textSecondary"
        required
      />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders a leading text mark when `leadingText` is passed and no `icon` is given', async () => {
    const { getByText } = await render(
      <FieldTrigger
        label="Currency"
        onPress={jest.fn()}
        value="AED — UAE Dirham"
        valueTone="textPrimary"
        leadingText="AED"
      />,
    );

    expect(getByText('AED')).toBeTruthy();
  });

  it('prefers `icon` over `leadingText` when both are somehow passed', async () => {
    const { queryByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Groceries"
        valueTone="textPrimary"
        icon="cart.fill"
        leadingText="AED"
      />,
    );

    expect(queryByText('AED')).toBeNull();
  });

  it('renders no FieldError and a plain label when `error` is undefined', async () => {
    const { queryByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Groceries"
        valueTone="textPrimary"
      />,
    );

    expect(queryByText('Pick one.')).toBeNull();
  });

  it('shows the FieldError message and tints the label negative when `error` is set', async () => {
    const { getByText, getByTestId } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Select a category"
        valueTone="textSecondary"
        error="Pick one."
        testID="category-field"
      />,
    );

    expect(getByText('Pick one.')).toBeTruthy();
    expect(getByTestId('category-field-error')).toBeTruthy();
    expect(getByText('Category').props.testID).toBe('text-tone-negative');
  });

  it('tints the label negative with no error line of its own when `invalid` is set', async () => {
    const { getByText, queryByTestId } = await render(
      <FieldTrigger
        label="Return to 1"
        onPress={jest.fn()}
        value="Select holding"
        valueTone="textSecondary"
        invalid
        testID="return-field"
      />,
    );

    expect(getByText('Return to 1').props.testID).toBe('text-tone-negative');
    expect(queryByTestId('return-field-error')).toBeNull();
  });
});

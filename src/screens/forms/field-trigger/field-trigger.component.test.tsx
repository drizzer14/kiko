import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import FieldTrigger from '.';

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
});

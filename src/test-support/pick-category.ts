import { fireEvent, type render } from '@testing-library/react-native';

/**
 * Picks a category from the field's bottom sheet: tapping the field opens the sheet, and the
 * option row is only mounted once it is open.
 */
export const pickCategory = async (
  utils: Awaited<ReturnType<typeof render>>,
  title: string,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Category'));
  await fireEvent.press(utils.getByText(title));
};

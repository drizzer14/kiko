import { type render, within } from '@testing-library/react-native';

import { ancestorWithStyle } from './ancestor-with-style';

/**
 * A failed Connect shows its message as an alert notice under the Connect row, never inside it.
 * The Button's own Pressable is a row too, so the walk starts at the button's parent: the nearest
 * row from there is the Connect row, and the notice must sit outside it.
 */
export const expectNoticeUnderConnectRow = async (
  view: Awaited<ReturnType<typeof render>>,
  connectLabel: string,
  message: string,
): Promise<void> => {
  expect(await view.findByRole('alert', { name: message })).toBeTruthy();

  const button = view.getByRole('button', { name: connectLabel });
  const buttonParent = button.parent;

  if (buttonParent === null) {
    throw new Error('Connect button has no parent');
  }

  const row = ancestorWithStyle(buttonParent, 'flexDirection');

  expect(row).not.toBe(button);
  expect(within(row).getByRole('button', { name: connectLabel })).toBe(button);
  expect(within(row).queryByRole('alert')).toBeNull();
  expect(within(row).queryByText(message)).toBeNull();
};

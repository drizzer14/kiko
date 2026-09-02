import { Alert, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import SwipeableRow from './index';

// The delete action is mounted behind the row content for the reveal
// animation, but is gated out of the accessibility tree until the row is
// swiped open. RNTL's default queries exclude a11y-hidden elements
// (`defaultIncludeHiddenElements: false`), so the button-wiring tests query
// with `includeHiddenElements: true` to reach the mounted-but-hidden button
// (which is exactly what a swiped-open row exposes to the user).
const HIDDEN = { includeHiddenElements: true } as const;

describe('SwipeableRow', () => {
  it('renders a delete action for an enabled row and confirms before deleting', async () => {
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const del = (buttons ?? []).find((b) => b.style === 'destructive');
      del?.onPress?.();
    });
    const { getByLabelText } = await render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(onDelete).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('passes the custom confirm title and message to the alert', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(
      <SwipeableRow
        onDelete={jest.fn()}
        confirmTitle="Remove account"
        confirmMessage="All holdings are removed too."
      >
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(spy).toHaveBeenCalledWith(
      'Remove account',
      'All holdings are removed too.',
      expect.any(Array),
    );
    spy.mockRestore();
  });

  it('does not delete when the confirmation is dismissed', async () => {
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(onDelete).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('hides the delete action from the accessibility tree while the row is closed', async () => {
    const { queryByLabelText } = await render(
      <SwipeableRow onDelete={jest.fn()}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    // A screen reader cannot reach it on a closed row...
    expect(queryByLabelText('Delete')).toBeNull();
    // ...even though it is mounted behind the content for the reveal.
    expect(queryByLabelText('Delete', HIDDEN)).not.toBeNull();
  });

  it('renders no delete action when disabled', async () => {
    const { queryByLabelText, getByText } = await render(
      <SwipeableRow onDelete={jest.fn()} disabled>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(queryByLabelText('Delete', HIDDEN)).toBeNull();
    expect(getByText('Row')).toBeTruthy();
  });
});

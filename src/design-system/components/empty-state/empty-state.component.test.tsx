import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';

import EmptyState from '.';

const TITLE = 'No accounts yet';
const MESSAGE = 'Add an account to start tracking your money.';
const ACTION = 'Add account';

describe('EmptyState', () => {
  it('renders the icon, the title, and the message', async () => {
    const { getByText, getByTestId } = await render(
      <EmptyState icon="creditcard" title={TITLE} message={MESSAGE} testID="empty" />,
    );

    expect(getByText(TITLE)).toBeTruthy();
    expect(getByText(MESSAGE)).toBeTruthy();
    expect(getByTestId('empty-icon').props.name).toBe('creditcard');
  });

  it('renders no button without an action', async () => {
    const { queryAllByRole } = await render(
      <EmptyState icon="creditcard" title={TITLE} message={MESSAGE} />,
    );

    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('renders the action label and reports a press', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <EmptyState
        icon="creditcard"
        title={TITLE}
        message={MESSAGE}
        action={{ label: ACTION, icon: 'plus', onPress }}
      />,
    );

    await fireEvent.press(getByText(ACTION));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('passes the testID through to the root and the action', async () => {
    const { getByTestId } = await render(
      <EmptyState
        icon="creditcard"
        title={TITLE}
        message={MESSAGE}
        action={{ label: ACTION, onPress: jest.fn() }}
        testID="empty"
      />,
    );

    expect(getByTestId('empty')).toBeTruthy();
    expect(getByTestId('empty-action')).toBeTruthy();
  });
});

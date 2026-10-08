import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import NotificationPreAlertSheet from '.';

const renderSheet = (overrides: { onContinue?: () => void; onClosed?: () => void } = {}) =>
  render(
    <NotificationPreAlertSheet
      visible
      onContinue={overrides.onContinue ?? jest.fn()}
      onClosed={overrides.onClosed ?? jest.fn()}
    />,
  );

describe('NotificationPreAlertSheet', () => {
  it('renders nothing while not visible', async () => {
    const { queryByText } = await render(
      <NotificationPreAlertSheet visible={false} onContinue={jest.fn()} onClosed={jest.fn()} />,
    );

    expect(queryByText(i18n.t('reminders.permission.preAlertTitle'))).toBeNull();
  });

  it('explains the notifications before iOS asks', async () => {
    const { getByText } = await renderSheet();

    expect(getByText('Reminder Notifications')).toBeTruthy();
    expect(
      getByText(
        'Kiko shows your reminders as notifications at the times you choose. Next, iOS asks whether to allow them.',
      ),
    ).toBeTruthy();
  });

  it('offers exactly one button, Continue, and never a Cancel or an Allow', async () => {
    const { getByTestId } = await renderSheet();

    const buttons = within(getByTestId('notification-pre-alert-sheet')).getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(within(buttons[0]).getByText('Continue')).toBeTruthy();
    expect(within(buttons[0]).queryByText(/allow/i)).toBeNull();
  });

  it('continues on the button', async () => {
    const onContinue = jest.fn();
    const { getByText } = await renderSheet({ onContinue });

    await fireEvent.press(getByText('Continue'));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('continues on a scrim dismiss too, since there is nothing to cancel', async () => {
    const onContinue = jest.fn();
    const { getByTestId } = await renderSheet({ onContinue });

    await fireEvent.press(getByTestId('notification-pre-alert-sheet-backdrop'));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('reports when the sheet has finished closing', async () => {
    const onClosed = jest.fn();
    const { getByTestId } = await renderSheet({ onClosed });

    await fireEvent(getByTestId('notification-pre-alert-sheet-modal'), 'dismiss');

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

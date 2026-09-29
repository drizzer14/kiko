import { Linking } from 'react-native';
import { remindersNative } from '@kiko/reminders/native';
import { act, fireEvent, type RenderResult, waitFor } from '@testing-library/react-native';

type PermissionNoticeCases = {
  renderList: (withReminder: boolean) => Promise<RenderResult>;
  syncReminders: jest.Mock;
  // What else must hold once the pre-alert is answered, such as the page
  // staying open.
  afterPreAlert?: () => void;
};

const DENIED_NOTICE = 'Notifications are off for Kiko, so reminders can’t appear.';

export const NOT_DETERMINED_NOTICE = 'Turn on notifications so your reminders can appear.';

// Both reminder lists build their notice with `usePermissionNotice`, so each
// runs the same cases against its own page. The test file spies on
// `remindersNative` before this runs.
export const permissionNoticeCases = ({
  renderList,
  syncReminders,
  afterPreAlert,
}: PermissionNoticeCases): void => {
  const authorizationStatus = jest.mocked(remindersNative.authorizationStatus);
  const requestAuthorization = jest.mocked(remindersNative.requestAuthorization);

  it('shows no notice while notifications are allowed', async () => {
    const { queryByText } = await renderList(true);

    await waitFor(() => expect(authorizationStatus).toHaveBeenCalled());
    expect(queryByText(DENIED_NOTICE)).toBeNull();
    expect(queryByText(NOT_DETERMINED_NOTICE)).toBeNull();
  });

  it('opens iOS Settings from the notice when notifications are denied', async () => {
    authorizationStatus.mockResolvedValue('denied');

    const { findByText, getByText } = await renderList(true);

    expect(await findByText(DENIED_NOTICE)).toBeTruthy();

    await fireEvent.press(getByText('Open iOS settings'));

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('shows no notice while there is no reminder to deliver', async () => {
    authorizationStatus.mockResolvedValue('denied');

    const { queryByText } = await renderList(false);

    await waitFor(() => expect(authorizationStatus).toHaveBeenCalled());
    expect(queryByText(DENIED_NOTICE)).toBeNull();
  });

  it('asks iOS through the pre-alert when a saved reminder has never asked', async () => {
    authorizationStatus.mockResolvedValue('notDetermined');

    const { findByText, getByText, getByTestId, queryByText } = await renderList(true);

    expect(await findByText(NOT_DETERMINED_NOTICE)).toBeTruthy();

    await fireEvent.press(getByText('Turn on notifications'));

    expect(getByText('Reminder Notifications')).toBeTruthy();
    expect(requestAuthorization).not.toHaveBeenCalled();

    const reportClosed: () => void = getByTestId('notification-pre-alert-sheet-modal').props
      .onDismiss;

    authorizationStatus.mockResolvedValue('authorized');
    await fireEvent.press(getByText('Continue'));
    await act(async () => {
      reportClosed();
    });

    await waitFor(() => expect(requestAuthorization).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(syncReminders).toHaveBeenCalled());
    await waitFor(() => expect(queryByText(NOT_DETERMINED_NOTICE)).toBeNull());
    afterPreAlert?.();
  });
};

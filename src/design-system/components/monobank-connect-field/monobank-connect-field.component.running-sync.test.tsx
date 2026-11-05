import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { runSync } from '@kiko/monobank/sync';

import MonobankConnectField from '.';

const mockFetchClientInfo = jest.fn();
const mockListAccounts = jest.fn();

// The REAL run and its join are under test: only the account read the run starts with is held,
// so the run stays in flight for as long as a case wants. `@kiko/accounts` is the one repo the
// run touches before it reads a token.
jest.mock('@kiko/accounts', () => ({
  accountsRepo: { listQuery: (...args: unknown[]) => mockListAccounts(...args) },
}));
jest.mock('@kiko/monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));

const RUNNING_TEXT = i18n.t('accountDetail.monobankSyncStillRunning');

const ACCOUNT_ID = 'running-sync-account';

// The Connect sync the screens hand the field: the real run for this account. The run stops at
// the account read (no such account is stored), which is enough to count the runs that started;
// the Connect itself reports success, as the field's own check is what the case is about.
const connectSync = async (): Promise<boolean> => {
  await runSync({ targetAccountId: ACCOUNT_ID }).catch(() => undefined);

  return true;
};

type View = Awaited<ReturnType<typeof render>>;

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    await fireEvent.press(view.getByText(i18n.t('accountDetail.connectMonobank')));
  });
};

describe('MonobankConnectField — a Connect that would join the run of a disconnected token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchClientInfo.mockResolvedValue({ name: 'Ada' });
  });

  it('shows the running text and starts no second run, then connects once the old run ends', async () => {
    const oldRun = { resolve: () => {} };
    mockListAccounts.mockReturnValueOnce(
      new Promise((resolve) => {
        oldRun.resolve = () => resolve([]);
      }),
    );
    mockListAccounts.mockResolvedValue([]);
    // The app-open sync, still in flight when the user disconnects and types a new token.
    const appOpenSync = runSync({ targetAccountId: ACCOUNT_ID });
    const oldRunEnded = expect(appOpenSync).rejects.toThrow(
      i18n.t('accountDetail.noMonobankConnection'),
    );
    const view = await render(
      <MonobankConnectField accountId={ACCOUNT_ID} onConnect={connectSync} />,
    );

    await fireEvent.changeText(view.getByDisplayValue(''), 'new-token');
    await pressConnect(view);

    expect(await view.findByText(RUNNING_TEXT)).toBeTruthy();
    expect(mockListAccounts).toHaveBeenCalledTimes(1);
    expect(mockFetchClientInfo).not.toHaveBeenCalled();
    expect(view.queryByText(/Connected as/)).toBeNull();
    expect(view.getByDisplayValue('new-token')).toBeTruthy();

    oldRun.resolve();
    await oldRunEnded;
    await pressConnect(view);

    expect(
      await view.findByText(i18n.t('accountDetail.connectedAs', { name: 'Ada' })),
    ).toBeTruthy();
    expect(view.queryByText(RUNNING_TEXT)).toBeNull();
    expect(mockFetchClientInfo).toHaveBeenCalledWith('new-token');
    expect(mockListAccounts).toHaveBeenCalledTimes(2);
  });
});

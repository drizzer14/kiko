import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import PrivatbankConnectField from './privatbank-connect-field.component';

const mockFetchAccounts = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('../../../privatbank/client', () => ({
  fetchAccounts: (...args: unknown[]) => mockFetchAccounts(...args),
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const connectLabel = i18n.t('accountDetail.connectPrivatbank');

beforeEach(() => {
  jest.clearAllMocks();
});

type View = Awaited<ReturnType<typeof render>>;

const fillBoth = async (view: View, token: string, clientId: string): Promise<void> => {
  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')),
    token,
  );
  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankClientIdPlaceholder')),
    clientId,
  );
};

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    fireEvent.press(view.getByText(connectLabel));
  });
};

it('shows the FOP eligibility notice', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  expect(view.getByText(i18n.t('accountDetail.privatbankFopNotice'))).toBeTruthy();
});

it('disables Connect until both the token and client id are entered', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);
  const connect = (): ReturnType<typeof view.getByRole> =>
    view.getByRole('button', { name: connectLabel });

  expect(connect()).toBeDisabled();

  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')),
    'tok-123',
  );
  expect(connect()).toBeDisabled();

  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankClientIdPlaceholder')),
    'client-1',
  );
  expect(connect()).not.toBeDisabled();
});

it('gives the Connect action a lock glyph and both paste buttons the clipboard glyph', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  expect((view.root?.queryAll((node) => node.props.name === 'lock') ?? []).length).toBeGreaterThan(
    0,
  );
  expect(
    (view.root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
  ).toBe(2);
});

it('pastes into the token and client id fields separately, trimmed', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  mockGetString.mockResolvedValue(' tok-123 ');
  await act(async () => {
    await fireEvent.press(view.getByLabelText(i18n.t('accountDetail.pastePrivatbankToken')));
  });
  mockGetString.mockResolvedValue('client-1\n');
  await act(async () => {
    await fireEvent.press(view.getByLabelText(i18n.t('accountDetail.pastePrivatbankClientId')));
  });

  expect(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')).props.value,
  ).toBe('tok-123');
  expect(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankClientIdPlaceholder')).props.value,
  ).toBe('client-1');
});

it('validates the pair, then calls onConnect and shows the success status', async () => {
  mockFetchAccounts.mockResolvedValue([]);
  const onConnect = jest.fn().mockResolvedValue(true);
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillBoth(view, '  tok-123  ', ' client-1 ');
  await pressConnect(view);

  expect(mockFetchAccounts).toHaveBeenCalledWith({ token: 'tok-123', clientId: 'client-1' });
  expect(onConnect).toHaveBeenCalledWith('tok-123', 'client-1');
  expect(await view.findByText(i18n.t('accountDetail.privatbankConnected'))).toBeTruthy();
  // SECURITY: the raw pair is dropped from state once connected.
  expect(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')).props.value,
  ).toBe('');
});

it('shows invalidPrivatbankCredentials and never calls onConnect when validation throws', async () => {
  mockFetchAccounts.mockRejectedValue(new Error('401'));
  const onConnect = jest.fn();
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillBoth(view, 'bad-token', 'bad-client');
  await pressConnect(view);

  expect(await view.findByText(i18n.t('accountDetail.invalidPrivatbankCredentials'))).toBeTruthy();
  // Validation runs BEFORE onConnect (which is where the screen's closure
  // saves credentials), so an invalid pair is never handed to onConnect —
  // no orphaned Keychain item.
  expect(onConnect).not.toHaveBeenCalled();
});

it('shows couldNotConnectPrivatbank when a valid pair fails to store/sync', async () => {
  mockFetchAccounts.mockResolvedValue([]);
  const onConnect = jest.fn().mockResolvedValue(false);
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillBoth(view, 'tok', 'client-1');
  await pressConnect(view);

  expect(await view.findByText(i18n.t('accountDetail.couldNotConnectPrivatbank'))).toBeTruthy();
  // A save/sync failure keeps the validated pair in the fields so the user
  // can retry the connect without retyping it, and Connect stays pressable.
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();
});

it('disables Connect while validation is in flight, even with both fields filled', async () => {
  let resolveFetch: (accounts: unknown[]) => void = () => {};
  mockFetchAccounts.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  await fillBoth(view, 'tok-123', 'client-1');
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();

  await pressConnect(view);

  expect(view.getByRole('button', { name: connectLabel })).toBeDisabled();

  await act(async () => {
    resolveFetch([]);
  });
});

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

const fillToken = async (view: View, token: string): Promise<void> => {
  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')),
    token,
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

it('disables Connect until the token is entered', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);
  const connect = (): ReturnType<typeof view.getByRole> =>
    view.getByRole('button', { name: connectLabel });

  expect(connect()).toBeDisabled();

  await fillToken(view, 'tok-123');
  expect(connect()).not.toBeDisabled();
});

it('gives the Connect action a lock glyph and the paste button the clipboard glyph', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  expect((view.root?.queryAll((node) => node.props.name === 'lock') ?? []).length).toBeGreaterThan(
    0,
  );
  expect(
    (view.root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
  ).toBe(1);
});

it('pastes into the token field, trimmed', async () => {
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  mockGetString.mockResolvedValue(' tok-123 ');
  await act(async () => {
    await fireEvent.press(view.getByLabelText(i18n.t('accountDetail.pastePrivatbankToken')));
  });

  expect(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')).props.value,
  ).toBe('tok-123');
});

it('validates the token, then calls onConnect and shows the success status', async () => {
  mockFetchAccounts.mockResolvedValue({ balances: [] });
  const onConnect = jest.fn().mockResolvedValue(true);
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillToken(view, '  tok-123  ');
  await pressConnect(view);

  expect(mockFetchAccounts).toHaveBeenCalledWith('tok-123');
  expect(onConnect).toHaveBeenCalledWith('tok-123');
  expect(await view.findByText(i18n.t('accountDetail.privatbankConnected'))).toBeTruthy();
  // SECURITY: the raw token is dropped from state once connected.
  expect(
    view.getByPlaceholderText(i18n.t('accountDetail.privatbankTokenPlaceholder')).props.value,
  ).toBe('');
});

it('shows invalidPrivatbankCredentials and never calls onConnect when validation throws', async () => {
  mockFetchAccounts.mockRejectedValue(new Error('401'));
  const onConnect = jest.fn();
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillToken(view, 'bad-token');
  await pressConnect(view);

  expect(await view.findByText(i18n.t('accountDetail.invalidPrivatbankCredentials'))).toBeTruthy();
  // Validation runs BEFORE onConnect (which is where the screen's closure
  // saves credentials), so an invalid token is never handed to onConnect —
  // no orphaned Keychain item.
  expect(onConnect).not.toHaveBeenCalled();
});

it('shows couldNotConnectPrivatbank when a valid token fails to store/sync', async () => {
  mockFetchAccounts.mockResolvedValue({ balances: [] });
  const onConnect = jest.fn().mockResolvedValue(false);
  const view = await render(<PrivatbankConnectField onConnect={onConnect} />);

  await fillToken(view, 'tok');
  await pressConnect(view);

  expect(await view.findByText(i18n.t('accountDetail.couldNotConnectPrivatbank'))).toBeTruthy();
  // A save/sync failure keeps the validated token in the field so the user
  // can retry the connect without retyping it, and Connect stays pressable.
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();
});

it('disables Connect while validation is in flight, even with the field filled', async () => {
  let resolveFetch: (balancePage: unknown) => void = () => {};
  mockFetchAccounts.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  const view = await render(<PrivatbankConnectField onConnect={jest.fn()} />);

  await fillToken(view, 'tok-123');
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();

  await pressConnect(view);

  expect(view.getByRole('button', { name: connectLabel })).toBeDisabled();

  await act(async () => {
    resolveFetch({ balances: [] });
  });
});

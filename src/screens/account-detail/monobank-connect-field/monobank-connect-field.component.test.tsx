import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import MonobankConnectField from './monobank-connect-field.component';

const mockFetchClientInfo = jest.fn();
jest.mock('../../../monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));

const connectLabel = i18n.t('accountDetail.connectMonobank');

beforeEach(() => {
  jest.clearAllMocks();
});

// This project's RNTL render is async, so every case awaits it.
type View = Awaited<ReturnType<typeof render>>;

const type = async (view: View, value: string): Promise<void> => {
  await fireEvent.changeText(view.getByDisplayValue(''), value);
};

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    fireEvent.press(view.getByText(connectLabel));
  });
};

it('disables Connect until a non-blank token is entered, then enables it', async () => {
  const view = await render(<MonobankConnectField onConnect={jest.fn()} />);
  expect(view.getByRole('button', { name: connectLabel })).toBeDisabled();

  await type(view, 'tok-123');
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();
});

it('gives the Connect action a lock glyph', async () => {
  const view = await render(<MonobankConnectField onConnect={jest.fn()} />);

  // The Connect affordance carries the Kiko UI `lock` glyph (the SFSymbolView
  // forwards `name` as a host prop).
  const glyphs = view.root?.queryAll((node) => node.props.name === 'lock') ?? [];
  expect(glyphs.length).toBeGreaterThan(0);
});

it('validates the token, then calls onConnect and shows "Connected as {name}" on success', async () => {
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada Lovelace' });
  const onConnect = jest.fn().mockResolvedValue(true);
  const view = await render(<MonobankConnectField onConnect={onConnect} />);

  await type(view, '  tok-123  ');
  await pressConnect(view);

  await waitFor(() => {
    expect(mockFetchClientInfo).toHaveBeenCalledWith('tok-123'); // trimmed
    expect(onConnect).toHaveBeenCalledWith('tok-123');
  });
  await waitFor(() =>
    expect(
      view.getByText(i18n.t('accountDetail.connectedAs', { name: 'Ada Lovelace' })),
    ).toBeTruthy(),
  );
  // SECURITY: the raw token is dropped from state once connected, so it is not
  // parked in the React tree — the field goes back to its blank display value.
  expect(view.getByDisplayValue('')).toBeTruthy();
});

it('shows invalidToken and never calls onConnect when validation throws', async () => {
  mockFetchClientInfo.mockRejectedValue(new Error('401'));
  const onConnect = jest.fn();
  const view = await render(<MonobankConnectField onConnect={onConnect} />);

  await type(view, 'bad');
  await pressConnect(view);

  await waitFor(() => expect(view.getByText(i18n.t('accountDetail.invalidToken'))).toBeTruthy());
  expect(onConnect).not.toHaveBeenCalled();
  // Unlike the success path, an invalid token is kept in the field so the user
  // can correct and retry it, rather than retyping it from scratch.
  expect(view.getByDisplayValue('bad')).toBeTruthy();
});

it('shows couldNotConnectMonobank when a valid token fails to store/sync', async () => {
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada' });
  const onConnect = jest.fn().mockResolvedValue(false);
  const view = await render(<MonobankConnectField onConnect={onConnect} />);

  await type(view, 'tok');
  await pressConnect(view);

  await waitFor(() =>
    expect(view.getByText(i18n.t('accountDetail.couldNotConnectMonobank'))).toBeTruthy(),
  );
  // A save/sync failure also keeps the validated token in the field so the user
  // can retry the connect without retyping it.
  expect(view.getByDisplayValue('tok')).toBeTruthy();
});

it('disables Connect while validation is in flight, even with a filled token', async () => {
  let resolveFetch: (info: { name: string }) => void = () => {};
  mockFetchClientInfo.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  const view = await render(<MonobankConnectField onConnect={jest.fn()} />);

  await type(view, 'tok-123');
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();

  await pressConnect(view);

  // Validation is still pending (fetchClientInfo has not resolved), so the
  // "checking" status must disable the button even though the token is filled.
  expect(view.getByRole('button', { name: connectLabel })).toBeDisabled();

  await act(async () => {
    resolveFetch({ name: 'Ada' });
  });
});

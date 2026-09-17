import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import BunqConnectField from './bunq-connect-field.component';

const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const connectLabel = i18n.t('accountDetail.connectBunq');

beforeEach(() => {
  jest.clearAllMocks();
});

type View = Awaited<ReturnType<typeof render>>;

const fillApiKey = async (view: View, apiKey: string): Promise<void> => {
  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.bunqApiKeyPlaceholder')),
    apiKey,
  );
};

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    fireEvent.press(view.getByText(connectLabel));
  });
};

it('shows the "create the API key in the bunq app" notice', async () => {
  const view = await render(<BunqConnectField onConnect={jest.fn()} />);

  expect(view.getByText(i18n.t('accountDetail.bunqApiKeyNotice'))).toBeTruthy();
});

it('disables Connect until the API key is entered', async () => {
  const view = await render(<BunqConnectField onConnect={jest.fn()} />);
  const connect = (): ReturnType<typeof view.getByRole> =>
    view.getByRole('button', { name: connectLabel });

  expect(connect()).toBeDisabled();

  await fillApiKey(view, 'bunq-key-123');

  expect(connect()).not.toBeDisabled();
});

it('gives the Connect action a lock glyph and the paste button the clipboard glyph', async () => {
  const view = await render(<BunqConnectField onConnect={jest.fn()} />);

  expect((view.root?.queryAll((node) => node.props.name === 'lock') ?? []).length).toBeGreaterThan(
    0,
  );
  expect(
    (view.root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
  ).toBe(1);
});

it('pastes into the API key field, trimmed', async () => {
  const view = await render(<BunqConnectField onConnect={jest.fn()} />);

  mockGetString.mockResolvedValue(' bunq-key-123 ');
  await act(async () => {
    await fireEvent.press(view.getByLabelText(i18n.t('accountDetail.pasteBunqApiKey')));
  });

  expect(view.getByPlaceholderText(i18n.t('accountDetail.bunqApiKeyPlaceholder')).props.value).toBe(
    'bunq-key-123',
  );
});

it('trims the key, calls onConnect, and shows the success status', async () => {
  const onConnect = jest.fn().mockResolvedValue(true);
  const view = await render(<BunqConnectField onConnect={onConnect} />);

  await fillApiKey(view, '  bunq-key-123  ');
  await pressConnect(view);

  expect(onConnect).toHaveBeenCalledWith('bunq-key-123');
  expect(await view.findByText(i18n.t('accountDetail.bunqConnected'))).toBeTruthy();
  // SECURITY: the raw key is dropped from state once connected.
  expect(view.getByPlaceholderText(i18n.t('accountDetail.bunqApiKeyPlaceholder')).props.value).toBe(
    '',
  );
});

it('shows couldNotConnectBunq and keeps the entered key when onConnect resolves false', async () => {
  const onConnect = jest.fn().mockResolvedValue(false);
  const view = await render(<BunqConnectField onConnect={onConnect} />);

  await fillApiKey(view, 'bunq-key-123');
  await pressConnect(view);

  expect(await view.findByText(i18n.t('accountDetail.couldNotConnectBunq'))).toBeTruthy();
  // A save/sync failure keeps the entered key in the field so the user can
  // retry the connect without retyping it, and Connect stays pressable.
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();
  expect(view.getByPlaceholderText(i18n.t('accountDetail.bunqApiKeyPlaceholder')).props.value).toBe(
    'bunq-key-123',
  );
});

it('disables Connect while onConnect is in flight, even with the field filled', async () => {
  let resolveConnect: (result: boolean) => void = () => {};
  const onConnect = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveConnect = resolve;
      }),
  );
  const view = await render(<BunqConnectField onConnect={onConnect} />);

  await fillApiKey(view, 'bunq-key-123');
  expect(view.getByRole('button', { name: connectLabel })).not.toBeDisabled();

  await pressConnect(view);

  expect(view.getByRole('button', { name: connectLabel })).toBeDisabled();

  await act(async () => {
    resolveConnect(true);
  });
});

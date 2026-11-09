import type { ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { setBybitCooldownUntil } from '@kiko/crypto-sync/bybit';

import BybitCredentialsField from '.';

const mockSaveBybitCredentials = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();
const mockIsBybitSyncRunning = jest.fn<boolean, [string]>();

jest.mock('@kiko/crypto-sync/run-crypto-sync', () => ({
  isBybitSyncRunning: (accountId: string) => mockIsBybitSyncRunning(accountId),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  saveBybitCredentials: (...args: unknown[]) => mockSaveBybitCredentials(...args),
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

// The Text primitive's tone -> color mapping lives in a react-native-unistyles variant that the
// project's Jest mock strips, so the resolved `tone` of the link is read from a testID.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

type View = Awaited<ReturnType<typeof render>>;
type OnConnect = ComponentProps<typeof BybitCredentialsField>['onConnect'];
type Answers = Record<string, unknown>;

const typedPair = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };
const savedToken = Symbol('saved');
const originalFetch = globalThis.fetch;

// The ten calls of a connect, in order, each with the result of a key that reads it.
const KEY_ROUTES: [string, unknown][] = [
  ['/v5/user/query-api', { readOnly: 1, isMaster: true, deadlineDay: 90 }],
  ['/v5/account/wallet-balance', { list: [{ coin: [] }] }],
  ['/v5/asset/transfer/query-account-coins-balance', { balance: [] }],
  ['/v5/asset/deposit/query-record', { rows: [] }],
  ['/v5/asset/deposit/query-internal-record', { rows: [] }],
  ['/v5/asset/withdraw/query-record', { rows: [] }],
  ['/v5/asset/transfer/query-inter-transfer-list', { list: [] }],
  ['/v5/account/transaction-log', { list: [] }],
  ['/v5/asset/exchange/query-convert-history', { list: [] }],
  ['/v5/asset/fundinghistory', { list: [] }],
];
const KEY_PATHS = KEY_ROUTES.map(([path]) => path);
const KEY_INFO_RESULT = KEY_ROUTES[0][1] as Record<string, unknown>;

const envelopeOf = (retCode: number, result?: unknown) => ({ retCode, result });

let asked: string[] = [];

// A Bybit that reads each route as a good key does, except where `answers` gives the body of a
// path; it keeps the path of every call it was asked.
const bybitAnswers = (answers: Answers = {}): void => {
  asked = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    const reads = envelopeOf(0, KEY_ROUTES.find(([path]) => path === pathname)?.[1]);

    asked.push(pathname);

    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => answers[pathname] ?? reads,
    };
  }) as unknown as typeof fetch;
};

const fillBoth = async (getByPlaceholderText: View['getByPlaceholderText']): Promise<void> => {
  await fireEvent.changeText(getByPlaceholderText('Bybit API key'), 'api-key-fixture');
  await fireEvent.changeText(getByPlaceholderText('Bybit API secret'), 'secret-fixture');
};

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Bybit'));
  });
};

const renderAndConnect = async (onConnect: OnConnect, accountId = 'acc-1'): Promise<View> => {
  const view = await render(<BybitCredentialsField accountId={accountId} onConnect={onConnect} />);

  await fillBoth(view.getByPlaceholderText);
  await pressConnect(view);

  return view;
};

describe('BybitCredentialsField', () => {
  const onConnect = jest.fn<Promise<boolean>, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    bybitAnswers();
    mockIsBybitSyncRunning.mockReturnValue(false);
    mockSaveBybitCredentials.mockResolvedValue(savedToken);
    onConnect.mockResolvedValue(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders two secure inputs, a Bybit link and a Connect Bybit action', async () => {
    const { getByPlaceholderText, getByText } = await render(
      <BybitCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('Bybit API key').props.secureTextEntry).toBe(true);
    expect(getByPlaceholderText('Bybit API secret').props.secureTextEntry).toBe(true);
    expect(getByText('Open Bybit API management')).toBeTruthy();
    expect(getByText('Connect Bybit')).toBeTruthy();
    expect(getByText(i18n.t('accountDetail.bybitKeychainDisclosure'))).toBeTruthy();
  });

  it('states the limits of the connection and what Kiko reads above the inputs', async () => {
    const view = await render(<BybitCredentialsField accountId="acc-1" onConnect={onConnect} />);
    const tree = JSON.stringify(view.toJSON());
    const at = (text: string): number => tree.indexOf(JSON.stringify(text).slice(1, -1));

    expect(at(i18n.t('accountDetail.bybitConnectLimits'))).toBeGreaterThan(-1);
    expect(at(i18n.t('accountDetail.bybitKinds'))).toBeGreaterThan(-1);
    expect(at(i18n.t('accountDetail.bybitConnectLimits'))).toBeLessThan(at('Bybit API key'));
    expect(at(i18n.t('accountDetail.bybitKinds'))).toBeLessThan(at('Bybit API key'));
  });

  it('shows a required error per blank field and calls no network when Connect is pressed', async () => {
    const view = await render(<BybitCredentialsField accountId="acc-1" onConnect={onConnect} />);

    await pressConnect(view);

    expect(await view.findByText('Enter the API key.')).toBeTruthy();
    expect(await view.findByText('Enter the secret key.')).toBeTruthy();
    expect(asked).toHaveLength(0);
  });

  it('the API management link is the exact URL of part 2, with no query string', async () => {
    const { getByText } = await render(
      <BybitCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    expect(getByText('Open Bybit API management').props.testID).toBe('text-tone-accent');

    await fireEvent.press(getByText('Open Bybit API management'));

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith('https://www.bybit.com/en/app/user/api-management');
  });

  it('checks the key with 10 calls, stores the pair, connects, and shows success', async () => {
    const { findByText } = await renderAndConnect(onConnect);

    expect(asked).toEqual(KEY_PATHS);
    expect(mockSaveBybitCredentials).toHaveBeenCalledWith('acc-1', typedPair);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(savedToken);
    expect(await findByText('Bybit connected')).toBeTruthy();
  });

  it('a read-write key is refused before any Keychain write', async () => {
    bybitAnswers({
      '/v5/user/query-api': envelopeOf(0, { ...KEY_INFO_RESULT, readOnly: 0 }),
    });

    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText(i18n.t('accountDetail.bybitKeyNotReadOnly'))).toBeTruthy();
    expect(asked).toHaveLength(1);
    expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('a rejected key shows the text that names a wrong key, Bybit EU as not supported, and another regional key as may not', async () => {
    bybitAnswers({ '/v5/user/query-api': envelopeOf(10003) });

    const { findByText } = await renderAndConnect(onConnect);
    const shown = await findByText(i18n.t('accountDetail.bybitKeyRejected'));

    expect(shown.props.children).toContain('Check the key and the secret.');
    expect(shown.props.children).toContain('does not support Bybit EU accounts');
    expect(shown.props.children).toContain('a key from another regional site may not be accepted');
    expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('a key not shown as a main key is refused before any Keychain write', async () => {
    bybitAnswers({
      '/v5/user/query-api': envelopeOf(0, { ...KEY_INFO_RESULT, isMaster: false }),
    });

    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText(i18n.t('accountDetail.bybitKeyNotMain'))).toBeTruthy();
    expect(asked).toHaveLength(1);
    expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it.each(KEY_PATHS.slice(1).map((path, index) => [path, index + 2] as const))(
    'a key refused on any shipped route is refused before any Keychain write, and connect makes 10 calls (%s refuses after %i calls)',
    async (path, calls) => {
      bybitAnswers({ [path]: envelopeOf(10005) });

      const { findByText } = await renderAndConnect(onConnect);

      expect(await findByText(i18n.t('accountDetail.bybitKeyMissingPermission'))).toBeTruthy();
      expect(asked).toHaveLength(calls);
      expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    },
  );

  it('shows a distinct save error and does not connect when the Keychain write fails', async () => {
    mockSaveBybitCredentials.mockRejectedValue(new Error('Keychain write failed'));

    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText('Could not save credentials')).toBeTruthy();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a connect error when the pair saved but the sync failed', async () => {
    onConnect.mockResolvedValue(false);

    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText('Could not connect Bybit')).toBeTruthy();
  });

  it('reports the token of the write instead of connecting when the field unmounted during it', async () => {
    const pending = { resolve: () => {} };
    const onStoredWhileUnmounted = jest.fn().mockResolvedValue(undefined);

    mockSaveBybitCredentials.mockImplementation(
      () =>
        new Promise<symbol>((resolve) => {
          pending.resolve = () => resolve(savedToken);
        }),
    );

    const view = await render(
      <BybitCredentialsField
        accountId="acc-1"
        onConnect={onConnect}
        onStoredWhileUnmounted={onStoredWhileUnmounted}
      />,
    );

    await fillBoth(view.getByPlaceholderText);
    await pressConnect(view);
    await view.unmount();
    await act(async () => {
      pending.resolve();
    });

    expect(onStoredWhileUnmounted).toHaveBeenCalledWith(savedToken);
    expect(onConnect).not.toHaveBeenCalled();
  });

  describe('while the account is cooling down', () => {
    it('shows the text that fits a ban and a rate refusal, and makes no request, write or sync', async () => {
      setBybitCooldownUntil('bybit-cooling-blocked', Date.now() + 60_000);

      const view = await renderAndConnect(onConnect, 'bybit-cooling-blocked');

      expect(await view.findByText(i18n.t('accountDetail.bybitForbidden'))).toBeTruthy();
      expect(asked).toHaveLength(0);
      expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('runs the whole Connect once the cooldown has ended', async () => {
      setBybitCooldownUntil('bybit-cooling-over', Date.now() - 1);

      const view = await renderAndConnect(onConnect, 'bybit-cooling-over');

      expect(await view.findByText('Bybit connected')).toBeTruthy();
      expect(asked).toHaveLength(10);
    });
  });

  describe('while a Bybit sync of the account is running', () => {
    it('shows the running text and makes no request, write or sync', async () => {
      mockIsBybitSyncRunning.mockImplementation((accountId) => accountId === 'bybit-run-blocked');

      const view = await renderAndConnect(onConnect, 'bybit-run-blocked');

      expect(await view.findByText(i18n.t('accountDetail.bybitSyncStillRunning'))).toBeTruthy();
      expect(asked).toHaveLength(0);
      expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('runs the whole Connect when another account is the one running', async () => {
      mockIsBybitSyncRunning.mockImplementation((accountId) => accountId === 'bybit-run-other');

      const view = await renderAndConnect(onConnect, 'bybit-run-free');

      expect(await view.findByText('Bybit connected')).toBeTruthy();
    });
  });
});

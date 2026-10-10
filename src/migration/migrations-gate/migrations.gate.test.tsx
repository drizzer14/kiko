import { StyleSheet, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { settingsRepo } from '@kiko/settings';
import { DatabaseKeyMissingError } from '@kiko/db';
import { darkTheme } from '@kiko/design-system/theme';

import MigrationsGate from './migrations.gate';

type SettingsRow = { language?: string | null };

const mockInitDatabase = jest.fn<Promise<void>, []>();
const mockRunMigrations = jest.fn<Promise<void>, []>();
const mockMigrateLegacyToken = jest.fn<Promise<void>, []>();
const mockMigratePerAccountToken = jest.fn<Promise<void>, [string | undefined]>();
const mockMigratePerAccountBinance = jest.fn<Promise<void>, [string | undefined]>();
const mockUpgradeStoredDedupKeys = jest.fn<Promise<void>, []>();
const mockRezoneImportTimes = jest.fn<Promise<void>, []>();
const mockConnectedQuery = jest.fn<Promise<{ id: string }[]>, [string?]>();
// Backs `settingsRepo.getQuery()` for `applyPersistedLanguage`. A test sets
// `mockGetSettings.mockResolvedValue(...)` / `mockRejectedValueOnce(...)`
// directly so it can also exercise the read-throws path.
const mockGetSettings = jest.fn<Promise<SettingsRow[]>, []>();
jest.mock('@kiko/db/client', () => ({ initDatabase: () => mockInitDatabase() }));
jest.mock('@kiko/db/run-migrations', () => ({ runMigrations: () => mockRunMigrations() }));
jest.mock('@kiko/monobank/token', () => ({ migrateLegacyToken: () => mockMigrateLegacyToken() }));
jest.mock('@kiko/monobank/migrate-credential', () => ({
  migrateSingleTokenToPerAccount: (id: string | undefined) => mockMigratePerAccountToken(id),
}));
jest.mock('@kiko/crypto-sync/binance/migrate-binance-credential', () => ({
  migrateBinanceCredentialToPerAccount: (id: string | undefined) =>
    mockMigratePerAccountBinance(id),
}));
jest.mock('@kiko/statement-import/upgrade-stored-dedup-keys/upgrade-stored-dedup-keys', () => ({
  upgradeStoredDedupKeys: () => mockUpgradeStoredDedupKeys(),
}));
jest.mock('@kiko/statement-import/rezone-import-times/rezone-import-times', () => ({
  rezoneImportTimes: () => mockRezoneImportTimes(),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { connectedQuery: (institution?: string) => mockConnectedQuery(institution) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { ensure: jest.fn(() => Promise.resolve()), getQuery: () => mockGetSettings() },
}));

// The real `i18n.changeLanguage` is spied on rather than the whole `../i18n`
// module mocked, so `i18next.use(initReactI18next).init(...)`'s side effect
// still runs — that is what makes `useTranslation()` inside the gate work.
const mockChangeLanguage = jest.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveCallback) => {
    resolve = resolveCallback;
  });

  return { promise, resolve };
};

describe('MigrationsGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitDatabase.mockResolvedValue(undefined);
    mockRunMigrations.mockResolvedValue(undefined);
    mockMigrateLegacyToken.mockResolvedValue(undefined);
    mockMigratePerAccountToken.mockResolvedValue(undefined);
    mockMigratePerAccountBinance.mockResolvedValue(undefined);
    mockUpgradeStoredDedupKeys.mockResolvedValue(undefined);
    mockRezoneImportTimes.mockResolvedValue(undefined);
    mockConnectedQuery.mockResolvedValue([]);
    (settingsRepo.ensure as jest.Mock).mockResolvedValue(undefined);
    mockGetSettings.mockResolvedValue([]);
  });

  it('shows the preparing state, then children once init, migrations and token migration all resolve', async () => {
    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(queryByText('Preparing database…')).toBeNull();
    expect(mockMigrateLegacyToken).toHaveBeenCalledTimes(1);
    expect(mockMigratePerAccountToken).toHaveBeenCalledTimes(1);
  });

  it('binds the token to the connected Monobank account id, after the legacy migration', async () => {
    const order: string[] = [];
    mockMigrateLegacyToken.mockImplementation(async () => {
      order.push('legacy');
    });
    mockConnectedQuery.mockResolvedValue([{ id: 'acc-mono' }]);
    mockMigratePerAccountToken.mockImplementation(async () => {
      order.push('per-account');
    });

    const { findByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(mockConnectedQuery).toHaveBeenCalledWith('monobank');
    expect(mockMigratePerAccountToken).toHaveBeenCalledWith('acc-mono');
    // The per-account bind runs AFTER the legacy (pre-`kiko` -> global) move.
    expect(order).toEqual(['legacy', 'per-account']);
  });

  it('binds the Binance credentials to the connected Binance account id', async () => {
    mockConnectedQuery.mockImplementation(async (institution?: string) =>
      institution === 'binance' ? [{ id: 'acc-binance' }] : [],
    );

    const { findByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(mockConnectedQuery).toHaveBeenCalledWith('binance');
    expect(mockMigratePerAccountBinance).toHaveBeenCalledWith('acc-binance');
  });

  it('runs the dedup-key upgrade once, after the credential migrations, then the import-time rezone', async () => {
    const order: string[] = [];
    mockMigratePerAccountBinance.mockImplementation(async () => {
      order.push('binance-credential');
    });
    mockUpgradeStoredDedupKeys.mockImplementation(async () => {
      order.push('dedup-key-upgrade');
    });
    mockRezoneImportTimes.mockImplementation(async () => {
      order.push('import-time-rezone');
    });

    const { findByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(mockUpgradeStoredDedupKeys).toHaveBeenCalledTimes(1);
    expect(mockRezoneImportTimes).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['binance-credential', 'dedup-key-upgrade', 'import-time-rezone']);
  });

  it('still renders children when the dedup-key upgrade rejects, rather than sending the whole launch to the error state', async () => {
    mockUpgradeStoredDedupKeys.mockRejectedValue(new Error('disk full SECRET'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { findByText, queryByTestId } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    // Non-critical, unlike every other migration above it in the chain: the
    // dedup-key upgrade is the one step whose own failure must not lock the
    // user out. Its own `write()` transaction (upgrade-stored-dedup-keys.ts)
    // leaves the flag at `false` on any rejection, so the next launch
    // retries — this gate just must not block on it meanwhile.
    expect(await findByText('ready')).toBeTruthy();
    expect(queryByTestId('migrations-gate-error')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[migrations-gate] dedup-key upgrade failed, will retry next launch',
      { name: 'Error', code: undefined },
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET');
    warnSpy.mockRestore();
  });

  it('still renders children when the import-time rezone rejects, rather than sending the whole launch to the error state', async () => {
    mockRezoneImportTimes.mockRejectedValue(new Error('disk full SECRET'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { findByText, queryByTestId } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    // Same non-critical reasoning as the dedup-key upgrade above: every
    // stored row is still reachable under its legacy time, and
    // `importParsedStatement` retries (and refuses on failure) before any
    // new-convention row could land next to an un-rezoned one.
    expect(await findByText('ready')).toBeTruthy();
    expect(queryByTestId('migrations-gate-error')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[migrations-gate] import-time rezone failed, will retry next launch',
      { name: 'Error', code: undefined },
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET');
    warnSpy.mockRestore();
  });

  it('passes undefined to the per-account migration when no Monobank account is connected', async () => {
    mockConnectedQuery.mockResolvedValue([]);

    const { findByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(mockMigratePerAccountToken).toHaveBeenCalledWith(undefined);
  });

  it('runs the schema migrations only after the database is initialized', async () => {
    const init = deferred<void>();
    mockInitDatabase.mockReturnValue(init.promise);

    const { findByText, getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(getByText('Preparing database…')).toBeTruthy();
    expect(mockRunMigrations).not.toHaveBeenCalled();

    await act(async () => {
      init.resolve();
      await init.promise;
    });

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(await findByText('ready')).toBeTruthy();
  });

  it('surfaces an initialization failure instead of rendering children', async () => {
    mockInitDatabase.mockRejectedValue(new Error('keychain unavailable'));

    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('Migration error: keychain unavailable')).toBeTruthy();
    expect(queryByText('ready')).toBeNull();
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it('explains a missing database key in plain words, not as a migration error', async () => {
    mockInitDatabase.mockRejectedValue(new DatabaseKeyMissingError());

    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText(i18n.t('migrations.keyMissing'))).toBeTruthy();
    expect(queryByText(/Migration error/)).toBeNull();
    expect(queryByText('ready')).toBeNull();
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it('surfaces a migration failure instead of rendering children', async () => {
    mockRunMigrations.mockRejectedValue(new Error('Missing migration: m0009'));

    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('Migration error: Missing migration: m0009')).toBeTruthy();
    expect(queryByText('ready')).toBeNull();
  });

  it('ensures the settings row before reporting success', async () => {
    const order: string[] = [];
    mockRunMigrations.mockImplementation(async () => {
      order.push('migrations');
    });
    (settingsRepo.ensure as jest.Mock).mockImplementation(async () => {
      order.push('ensure');
    });

    const { getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(getByText('ready')).toBeTruthy();
    expect(order).toEqual(['migrations', 'ensure']);
  });

  it('reports an error when the settings insert fails', async () => {
    (settingsRepo.ensure as jest.Mock).mockRejectedValueOnce(new Error('insert failed'));

    const { getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(getByText(/insert failed/)).toBeTruthy();
  });

  it('applies the persisted language before reporting success', async () => {
    mockGetSettings.mockResolvedValue([{ language: 'uk' }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockChangeLanguage).toHaveBeenCalledWith('uk');
  });

  it('leaves the device language alone when none is persisted', async () => {
    mockGetSettings.mockResolvedValue([{ language: null }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  it('does not fail the gate when the language read throws', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('db gone'));

    const { getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    // A language preference is cosmetic: it must never block the app from
    // starting.
    expect(getByText('ready')).toBeTruthy();
  });

  it('renders the pending state full-bleed on the dark surface', async () => {
    mockRunMigrations.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    const style = StyleSheet.flatten(getByTestId('migrations-gate-pending').props.style);

    expect(style.flex).toBe(1);
    expect(style.backgroundColor).toBe(darkTheme.colors.background);
  });

  it('renders the error state the same way', async () => {
    mockRunMigrations.mockRejectedValueOnce(new Error('boom'));

    const { getByTestId } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    const style = StyleSheet.flatten(getByTestId('migrations-gate-error').props.style);

    expect(style.flex).toBe(1);
    expect(style.backgroundColor).toBe(darkTheme.colors.background);
  });
});

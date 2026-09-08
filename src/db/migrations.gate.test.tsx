import { act, render } from '@testing-library/react-native';
import { Appearance, StyleSheet, Text } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import '../design-system/unistyles';
import { darkTheme } from '../design-system/theme';
import { i18n } from '../i18n';
import { settingsRepo } from '../repositories/settings.repo';

import MigrationsGate from './migrations.gate';

type SettingsRow = { language?: string | null; appearance?: string | null };

const mockInitDatabase = jest.fn<Promise<void>, []>();
const mockRunMigrations = jest.fn<Promise<void>, []>();
const mockMigrateLegacyToken = jest.fn<Promise<void>, []>();
// Backs `settingsRepo.getQuery()` for `applyPersistedLanguage` and
// `applyPersistedAppearance`. A test sets `mockGetSettings.mockResolvedValue(...)`
// / `mockRejectedValueOnce(...)` directly so it can also exercise the
// read-throws path.
const mockGetSettings = jest.fn<Promise<SettingsRow[]>, []>();
jest.mock('./client', () => ({ initDatabase: () => mockInitDatabase() }));
jest.mock('./run-migrations', () => ({ runMigrations: () => mockRunMigrations() }));
jest.mock('../monobank/token', () => ({ migrateLegacyToken: () => mockMigrateLegacyToken() }));
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { ensure: jest.fn(() => Promise.resolve()), getQuery: () => mockGetSettings() },
}));

// The real `i18n.changeLanguage` is spied on rather than the whole `../i18n`
// module mocked, so `i18next.use(initReactI18next).init(...)`'s side effect
// still runs — that is what makes `useTranslation()` inside the gate work.
const mockChangeLanguage = jest.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
// Option B: adaptiveThemes is OFF, so `applyPersistedAppearance` drives the JS
// theme MANUALLY through `UnistylesRuntime.setTheme` and the native chrome
// through `Appearance.setColorScheme` (see src/appearance/appearance.ts). The
// old adaptive `setAdaptiveThemes` toggle is gone, so that spy exists only to
// assert it is NEVER touched now.
const mockSetAdaptiveThemes = jest
  .spyOn(UnistylesRuntime, 'setAdaptiveThemes')
  .mockImplementation(() => {});
const mockSetTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
const mockSetColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

describe('MigrationsGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitDatabase.mockResolvedValue(undefined);
    mockRunMigrations.mockResolvedValue(undefined);
    mockMigrateLegacyToken.mockResolvedValue(undefined);
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

  it('applies a pinned dark appearance before reporting success', async () => {
    mockGetSettings.mockResolvedValue([{ appearance: 'dark' }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockSetColorScheme).toHaveBeenCalledWith('dark');
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    expect(mockSetAdaptiveThemes).not.toHaveBeenCalled();
  });

  it('applies a pinned light appearance before reporting success', async () => {
    mockGetSettings.mockResolvedValue([{ appearance: 'light' }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockSetColorScheme).toHaveBeenCalledWith('light');
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(mockSetAdaptiveThemes).not.toHaveBeenCalled();
  });

  it("drives the JS theme from the OS scheme and clears the native override with 'auto' for a 'system' appearance", async () => {
    mockGetSettings.mockResolvedValue([{ appearance: 'system' }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockSetColorScheme).toHaveBeenCalledWith('auto');
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(mockSetAdaptiveThemes).not.toHaveBeenCalled();
  });

  it('leaves the appearance alone when none is persisted', async () => {
    mockGetSettings.mockResolvedValue([{ appearance: null }]);

    await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(mockSetAdaptiveThemes).not.toHaveBeenCalled();
    expect(mockSetTheme).not.toHaveBeenCalled();
  });

  it('does not fail the gate when the appearance read throws', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('db gone'));

    const { getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    // An appearance preference is cosmetic: it must never block the app from
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

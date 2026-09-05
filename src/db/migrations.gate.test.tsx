import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import MigrationsGate from './migrations.gate';

const mockInitDatabase = jest.fn<Promise<void>, []>();
const mockRunMigrations = jest.fn<Promise<void>, []>();
const mockMigrateLegacyToken = jest.fn<Promise<void>, []>();
jest.mock('./client', () => ({ initDatabase: () => mockInitDatabase() }));
jest.mock('./run-migrations', () => ({ runMigrations: () => mockRunMigrations() }));
jest.mock('../monobank/token', () => ({ migrateLegacyToken: () => mockMigrateLegacyToken() }));

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
  });

  it('shows the preparing state, then children once init, migrations and token migration all resolve', async () => {
    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(queryByText('Preparing database...')).toBeNull();
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

    expect(getByText('Preparing database...')).toBeTruthy();
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
});

import { type FC, type ReactNode, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { migrateLegacyToken } from '../monobank/token';
import { runMigrations } from './run-migrations';

type MigrationState =
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; error: Error };

const MigrationsGate: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<MigrationState>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;

    // Run the schema migrations, then migrate a legacy Keychain token, before
    // reporting success. Because children (and thus the auto-sync hook that
    // first reads the token) mount only on success, awaiting the token
    // migration here guarantees it completes before any token read.
    runMigrations()
      .then(() => migrateLegacyToken())
      .then(() => {
        if (!cancelled) {
          setState({ status: 'success' });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setState({ status: 'error', error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'error') {
    return (
      <View>
        <Text>Migration error: {state.error.message}</Text>
      </View>
    );
  }

  if (state.status === 'pending') {
    return (
      <View>
        <Text>Preparing database...</Text>
      </View>
    );
  }

  return <>{children}</>;
};

export default MigrationsGate;

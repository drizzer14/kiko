import { type FC, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { migrateLegacyToken } from '../monobank/token';

import { initDatabase } from './client';
import { runMigrations } from './run-migrations';

type MigrationState =
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; error: Error };

const MigrationsGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [state, setState] = useState<MigrationState>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;

    // The encrypted connection (and, on the first launch after encryption
    // shipped, the plaintext -> encrypted export) must exist before the schema
    // migrator runs; the legacy Keychain-token migration runs last, before any
    // token read (the auto-sync hook mounts only on success).
    initDatabase()
      .then(runMigrations)
      .then(migrateLegacyToken)
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
        <Text>{t('migrations.error', { message: state.error.message })}</Text>
      </View>
    );
  }

  if (state.status === 'pending') {
    return (
      <View>
        <Text>{t('migrations.preparing')}</Text>
      </View>
    );
  }

  return <>{children}</>;
};

export default MigrationsGate;

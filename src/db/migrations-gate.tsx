import { useMigrations } from 'drizzle-orm/op-sqlite/migrator';
import type { FC, ReactNode } from 'react';
import { Text, View } from 'react-native';
import migrations from '../../drizzle/migrations/migrations';
import { database } from './client';

export const MigrationsGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { success, error } = useMigrations(database, migrations);

  if (error) {
    return (
      <View>
        <Text>Migration error: {error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View>
        <Text>Preparing database...</Text>
      </View>
    );
  }

  return <>{children}</>;
};

import { type FC, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../design-system/components/box';
import Text from '../design-system/components/text';
import { i18n } from '../i18n';
import { migrateLegacyToken } from '../monobank/token';
import { settingsRepo } from '../repositories/settings.repo';

import { initDatabase } from './client';
import { styles } from './migrations.gate.styles';
import { runMigrations } from './run-migrations';

type MigrationState =
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; error: Error };

/**
 * Apply the persisted language before the first gate paints.
 *
 * i18next initializes with the DEVICE language (src/i18n/index.ts), and the
 * only `changeLanguage` caller (`useSyncLanguageWithSettings`) is mounted from
 * `AppRoot` — which renders only after this gate succeeds AND `LockGate`
 * unlocks. So a user with device `en` and `settings.language = 'uk'` read
 * "Preparing database…", "Locked", "Unlock with Face ID…" and "Unlock" in
 * English on every cold launch, with Ukrainian appearing only after Face ID
 * succeeded (and the mirror case showed a Ukrainian lock screen to an `en`
 * user).
 *
 * A failure here is swallowed on purpose: a language preference is cosmetic
 * and must never block the app from starting — the device language stays
 * active. `useSyncLanguageWithSettings` still handles a LIVE switch from the
 * Settings screen once `AppRoot` mounts. Plain `try`/`catch` here, not
 * `fnts`'s `either` — this is a gate bootstrap step, not a data-layer call
 * (see `kiko-code-style`'s carve-out for this exact file).
 */
const applyPersistedLanguage = async (): Promise<void> => {
  try {
    const rows = await settingsRepo.getQuery();
    const language = rows.at(0)?.language;

    if (language != null && language !== i18n.language) {
      await i18n.changeLanguage(language);
    }
  } catch {
    // Cosmetic only — see the doc comment above.
  }
};

const MigrationsGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [state, setState] = useState<MigrationState>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;

    // The encrypted connection (and, on the first launch after encryption
    // shipped, the plaintext -> encrypted export) must exist before the schema
    // migrator runs. The single settings row (id = 1) must exist before ANY
    // gate reads settings: LockGate reads `lockEnabled`, and
    // `applyPersistedLanguage` reads `language`, all before AppRoot mounts —
    // so it is awaited here, not fire-and-forget from AppRoot, meaning no
    // setter can ever run against a missing row, and a failed insert surfaces
    // as this gate's error state instead of an unhandled rejection. The
    // persisted language is applied next, before either gate paints anything
    // user-visible. The legacy Keychain-token migration runs last, before any
    // token read (the auto-sync hook mounts only on success).
    initDatabase()
      .then(runMigrations)
      .then(() => settingsRepo.ensure())
      .then(applyPersistedLanguage)
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
      <Box testID="migrations-gate-error" style={styles.fill}>
        <Text variant="body" tone="textSecondary">
          {t('migrations.error', { message: state.error.message })}
        </Text>
      </Box>
    );
  }

  if (state.status === 'pending') {
    return (
      <Box testID="migrations-gate-pending" style={styles.fill}>
        <Text variant="body" tone="textSecondary">
          {t('migrations.preparing')}
        </Text>
      </Box>
    );
  }

  return <>{children}</>;
};

export default MigrationsGate;

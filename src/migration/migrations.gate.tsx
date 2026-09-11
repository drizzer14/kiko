import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { migrateBinanceCredentialToPerAccount } from '@kiko/crypto-sync/binance/migrate-binance-credential';
import { initDatabase } from '@kiko/db/client';
import { runMigrations } from '@kiko/db/run-migrations';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { i18n } from '@kiko/i18n';
import { migrateSingleTokenToPerAccount } from '@kiko/monobank/migrate-credential';
import { migrateLegacyToken } from '@kiko/monobank/token';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { type FC, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './migrations.gate.styles';

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

/**
 * Move the single global Monobank token to a per-account Keychain item, bound to
 * the currently-connected Monobank account (multi-account plan, 2026-09-11). Runs
 * in the boot chain AFTER `migrateLegacyToken` (which first brings a pre-`kiko`
 * token up to the global item) and BEFORE any per-account token read.
 *
 * The connected account id is resolved with a one-shot read of the same
 * `connectedQuery` the sync fan-out uses; there is at most one connected Monobank
 * account today (the one-connection invariant relaxes in a later phase), so the
 * first row's id is the binding target. When none is connected the migration is a
 * no-op that leaves the global item for a later Connect to adopt — see
 * `migrateSingleTokenToPerAccount`.
 */
const migratePerAccountMonobankToken = async (): Promise<void> => {
  const connected = await accountsRepo.connectedQuery('monobank');

  await migrateSingleTokenToPerAccount(connected.at(0)?.id);
};

/**
 * Move the single global Binance credentials to a per-account Keychain item, bound
 * to the currently-connected Binance account (multi-account plan, 2026-09-11). The
 * exact counterpart of `migratePerAccountMonobankToken` above: it runs in the boot
 * chain AFTER that Monobank migration and BEFORE any per-account credential read.
 * There is at most one connected Binance account today (the one-connection
 * invariant relaxes in Task 5.2), so the first row's id is the binding target;
 * when none is connected the migration is a no-op that leaves the global item for a
 * later Connect to adopt — see `migrateBinanceCredentialToPerAccount`.
 */
const migratePerAccountBinanceCredential = async (): Promise<void> => {
  const connected = await accountsRepo.connectedQuery('binance');

  await migrateBinanceCredentialToPerAccount(connected.at(0)?.id);
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
    // user-visible. The Keychain-token migrations run last, before any token
    // read (the auto-sync hook mounts only on success): first the legacy
    // (pre-`kiko`) -> global move, then the global -> per-account move that binds
    // the Monobank token to its connected account, then the equivalent global ->
    // per-account move for the Binance credentials.
    initDatabase()
      .then(runMigrations)
      .then(() => settingsRepo.ensure())
      .then(applyPersistedLanguage)
      .then(migrateLegacyToken)
      .then(migratePerAccountMonobankToken)
      .then(migratePerAccountBinanceCredential)
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

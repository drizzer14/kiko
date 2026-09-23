// src/data-transfer/payload.d.ts
import type { DataSnapshot } from './snapshot/data-snapshot';

export type ExportSecrets = {
  /**
   * DISPLAY-ONLY. Included so a power user has an out-of-band record of the
   * device's SQLCipher key, but NEVER re-imported into the Keychain — see the
   * safety comment on `restoreExportSecrets` (`secrets/restore-secrets.ts`)
   * for exactly why re-storing a foreign device's DB key would brick the
   * importing device's OWN encrypted database on its next launch.
   */
  dbKeyHex?: string;
  monobankTokens: { accountId: string; token: string }[];
  binanceCredentials: { accountId: string; apiKey: string; secret: string }[];
};

/** The plaintext JSON that gets AES-256-GCM-encrypted into the `.kiko` file. */
export type ExportPayload = {
  exportedAt: number;
  appVersion: string;
  tables: DataSnapshot;
  /** Present only when the user opted into "include saved credentials". */
  secrets?: ExportSecrets;
};

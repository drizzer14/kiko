// src/data-transfer/payload.d.ts
import type { DataSnapshot } from './snapshot/data-snapshot';

export type ExportSecrets = {
  monobankTokens: { accountId: string; token: string }[];
  binanceCredentials: { accountId: string; apiKey: string; secret: string }[];
  /** Absent in a file exported with no saved key, or before the key existed. */
  eodhdKey?: string;
};

/** The plaintext JSON that gets AES-256-GCM-encrypted into the `.kiko` file. */
export type ExportPayload = {
  exportedAt: number;
  appVersion: string;
  tables: DataSnapshot;
  /** Present only when the user opted into "include saved credentials". */
  secrets?: ExportSecrets;
};

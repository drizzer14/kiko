// Pure encoder: a `DataSnapshot` + a 32-byte AES key -> the JSON string
// written verbatim into a committed `.kiko` file. Uses the SAME export
// crypto the app's real Export Data screen uses (`encryptEnvelope`,
// `src/data-transfer/crypto/envelope.ts`), so a committed fixture round-trips
// through the real Import UI exactly like a user's own export.
import { ANCHOR } from '../seed/screenshot-seed';
import type { ExportPayload } from '../../../src/data-transfer/payload';
import { encryptEnvelope } from '../../../src/data-transfer/crypto/envelope';
import type { DataSnapshot } from '../../../src/data-transfer/snapshot/data-snapshot';

/**
 * Builds the plaintext `ExportPayload`. `exportedAt` is the dataset's own
 * fixed `ANCHOR`, never `Date.now()` — a real timestamp would make the
 * committed artefact churn on every regen for no reason. No `secrets` key:
 * this is fabricated demo data, never a real user's Monobank token or
 * Binance credentials.
 */
const payloadFor = (snapshot: DataSnapshot): ExportPayload => ({
  exportedAt: ANCHOR,
  appVersion: '1.0.0',
  tables: snapshot,
});

export const buildDemoEnvelopeJson = (snapshot: DataSnapshot, key: Uint8Array): string =>
  JSON.stringify(
    encryptEnvelope(new TextEncoder().encode(JSON.stringify(payloadFor(snapshot))), key),
  );

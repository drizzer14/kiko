// Two modes:
//
//   REGEN (KIKO_REGEN_DEMO=1): regenerates the committed `.kiko` fixtures
//   (and, the first time, the shared key) from the current dataset builder.
//   Run this manually after a `screenshot-seed.ts` change:
//     KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts
//
//   GUARD (always, both modes): decrypts every committed `.kiko` with the
//   committed key and asserts its payload deep-equals what the CURRENT
//   dataset builder produces. This is what `make gate` runs on every future
//   commit, so it must pass with no env var — it is what turns a stale
//   committed artefact into a test failure instead of a silent lie.
//
// `encryptEnvelope` uses a fresh random nonce every call (see
// `envelope.ts`), so the ciphertext is NEVER byte-reproducible — the guard
// below decrypts and compares the PAYLOAD, never the raw `.kiko` bytes.
import {
  decryptEnvelope,
  EXPORT_FORMAT,
  type ExportEnvelope,
  EXPORT_VERSION,
  type ExportPayload,
  generateExportKey,
  decodeBase64ToBytes,
  encodeBytesToBase64,
} from '@kiko/data-transfer';
import { join } from 'node:path';
import maybe, { foldMap } from 'fnts/maybe';
import { accounts, holdings, reminders } from '@kiko/db';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import { isReminderSchedule } from '@kiko/reminders/schedule';
import type { AppLanguage } from '@kiko/i18n/device-language';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ANCHOR, buildScreenshotDataset } from '../seed/screenshot-seed';

import { buildDemoSnapshot } from './build-demo-snapshot';
import { buildDemoEnvelopeJson } from './generate-demo-kiko';

const FIXTURES_DIR = __dirname;
const KEY_PATH = join(FIXTURES_DIR, 'kiko-demo.key');

const LANGUAGES: { language: AppLanguage; fileName: string }[] = [
  { language: 'uk', fileName: 'kiko-demo-uk.kiko' },
  { language: 'en', fileName: 'kiko-demo-en.kiko' },
];

const readOrCreateKey = (): Uint8Array => {
  if (existsSync(KEY_PATH)) {
    return decodeBase64ToBytes(readFileSync(KEY_PATH, 'utf8'));
  }

  const key = generateExportKey();

  writeFileSync(KEY_PATH, encodeBytesToBase64(key), 'utf8');

  return key;
};

describe('buildDemoEnvelopeJson (always runs — proves the encoder itself, not just the committed artefacts)', () => {
  it('round-trips a snapshot through the real export crypto with no drift', () => {
    const snapshot = buildDemoSnapshot(buildScreenshotDataset('uk'));
    const key = generateExportKey();
    const envelope: ExportEnvelope = JSON.parse(buildDemoEnvelopeJson(snapshot, key));
    const plaintext = decryptEnvelope(envelope, key);
    const payload: ExportPayload = JSON.parse(new TextDecoder().decode(plaintext));

    expect(payload.tables).toEqual(snapshot);
    expect(payload.exportedAt).toBe(ANCHOR);
    expect(payload.appVersion).toBe('1.0.0');
    expect(payload.secrets).toBeUndefined();
  });
});

// The App Store reviewer reaches every feature through this dataset
// (Guideline 5.6), so an account kind, holding type, or reminder kind missing
// from it is a feature the reviewer cannot see.
describe('the demo dataset covers every account kind, holding type, and reminder kind', () => {
  for (const { language } of LANGUAGES) {
    it(`${language}: holds at least one account of every kind and one holding of every type`, () => {
      const snapshot = buildDemoSnapshot(buildScreenshotDataset(language));

      expect(new Set(snapshot.accounts.map((account) => account.kind))).toEqual(
        new Set(accounts.kind.enumValues),
      );
      expect(new Set(snapshot.holdings.map((holding) => holding.type))).toEqual(
        new Set(holdings.type.enumValues),
      );
    });

    // A reminder on an ineligible account is never scheduled and its page
    // shows it as not sent, so the reviewer would not see it work.
    it(`${language}: holds one reminder of every kind, each on an account eligible for it`, () => {
      const snapshot = buildDemoSnapshot(buildScreenshotDataset(language));
      const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));

      expect(new Set(snapshot.reminders.map((reminder) => reminder.kind))).toEqual(
        new Set(reminders.kind.enumValues),
      );

      for (const reminder of snapshot.reminders) {
        const eligibleKinds =
          foldMap(maybe(accountsById.get(reminder.accountId)), eligibleReminderKinds) ?? [];

        expect(eligibleKinds).toContain(reminder.kind);
        expect(isReminderSchedule(reminder.schedule)).toBe(true);
      }
    });
  }
});

if (process.env.KIKO_REGEN_DEMO === '1') {
  describe('regenerate the committed demo .kiko fixtures', () => {
    it('writes kiko-demo.key (reusing it if already committed) and both .kiko files', () => {
      const key = readOrCreateKey();

      for (const { language, fileName } of LANGUAGES) {
        const snapshot = buildDemoSnapshot(buildScreenshotDataset(language));

        writeFileSync(join(FIXTURES_DIR, fileName), buildDemoEnvelopeJson(snapshot, key), 'utf8');
      }

      expect(existsSync(KEY_PATH)).toBe(true);
    });
  });
}

describe('the committed demo .kiko fixtures decrypt back to the current dataset', () => {
  // Read at RUN time, not at collection time — collection runs every
  // describe body before any `it` body, so reading here eagerly would race
  // the REGEN suite above, which writes the key inside its own `it`.
  let key: Uint8Array;

  beforeAll(() => {
    key = decodeBase64ToBytes(readFileSync(KEY_PATH, 'utf8'));
  });

  for (const { language, fileName } of LANGUAGES) {
    it(`${fileName} decrypts to buildDemoSnapshot(buildScreenshotDataset('${language}')), with no secrets block`, () => {
      const envelope: ExportEnvelope = JSON.parse(
        // The file name comes from the LANGUAGES table, so the rule cannot see its extension.
        // nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(.kiko fixture from a table)
        readFileSync(join(FIXTURES_DIR, fileName), 'utf8'),
      );
      const plaintext = decryptEnvelope(envelope, key);
      const payload: ExportPayload = JSON.parse(new TextDecoder().decode(plaintext));

      expect(envelope.format).toBe(EXPORT_FORMAT);
      expect(envelope.version).toBe(EXPORT_VERSION);
      expect(payload.secrets).toBeUndefined();
      expect(payload.tables).toEqual(buildDemoSnapshot(buildScreenshotDataset(language)));
    });
  }
});

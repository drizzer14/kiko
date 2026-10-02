const mockReadFile = jest.fn();
jest.mock('react-native-fs', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }));

const mockRestoreDataSnapshot = jest.fn();
jest.mock('./snapshot/restore-snapshot', () => ({
  restoreDataSnapshot: (snapshot: unknown) => mockRestoreDataSnapshot(snapshot),
}));

const mockRestoreExportSecrets = jest.fn();
jest.mock('./secrets/restore-secrets', () => ({
  restoreExportSecrets: (secrets: unknown, accountIds: unknown) =>
    mockRestoreExportSecrets(secrets, accountIds),
}));

// The first-add refresh trigger (kiko-architecture): an import bulk-inserts
// holdings directly, bypassing the sync fan-out that normally triggers a
// rate/metal refresh — so a restored foreign-currency/metal/crypto holding
// needs the SAME gated refresh triggered explicitly, right here.
const mockRefreshMarketData = jest.fn().mockResolvedValue(right(undefined));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));

// A restored key's daily limit is unconfirmed: the refresh must plan under the
// limit EODHD reports, not the one stored before the restore.
const mockConfirmDailyLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/prices/daily-limit', () => ({
  confirmDailyLimit: (...args: unknown[]) => mockConfirmDailyLimit(...args),
}));

// A bulk restore bypasses the sync/import/loan-edit call sites that
// normally trigger the auto-link matcher — trigger it explicitly here too,
// the same "first-add refresh" reasoning as `refreshMarketData` above.
// `runLoanAutoLink` itself returns early with no loan (its own doc comment),
// so this is a no-op for a restore with none.
const mockRunLoanAutoLink = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));

// A backup made before the one-time lot recost restores with its flag unset,
// so the recost runs again on the restored lots.
const mockRecostStoredLots = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/holdings/lot-recost/lot-recost', () => ({
  recostStoredLots: () => mockRecostStoredLots(),
}));

// The restore re-plans the reminders the moment its data commits, so the plan
// is never left to the steps after it.
const mockReplanRestoredReminders = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/reminders/use-reminder-scheduler', () => ({
  replanRestoredReminders: () => mockReplanRestoredReminders(),
}));

import { right } from 'fnts/either';
import { utf8ToBytes } from '@noble/ciphers/utils.js';

import { importData } from './import-data';
import { encryptEnvelope } from './crypto/envelope';
import { encodeBytesToBase64 } from './base64/base64';
import { generateExportKey } from './crypto/generate-key';

const payload = {
  exportedAt: 1,
  appVersion: '1.1.0',
  tables: {
    accounts: [{ id: 'a1' }],
    holdings: [{ id: 'h1' }],
    transactions: [{ id: 't1' }],
    currencyRates: [],
    currencyRateHistory: [],
    settings: [],
    syncState: [],
    categories: [],
    categoryOverrides: [],
  },
};

const encryptedFixture = (): { fileText: string; keyBase64: string } => {
  const key = generateExportKey();
  const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payload)), key);

  return { fileText: JSON.stringify(envelope), keyBase64: encodeBytesToBase64(key) };
};

describe('importData', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockRestoreDataSnapshot.mockReset().mockResolvedValue({ accountsRestored: 1 });
    mockRestoreExportSecrets.mockReset().mockResolvedValue([]);
    mockRefreshMarketData.mockClear();
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockConfirmDailyLimit.mockReset().mockResolvedValue(undefined);
    mockRunLoanAutoLink.mockClear();
    mockRunLoanAutoLink.mockResolvedValue(undefined);
    mockRecostStoredLots.mockReset().mockResolvedValue(undefined);
    mockReplanRestoredReminders.mockReset().mockResolvedValue(undefined);
  });

  it('re-plans the reminders right after the restore commits', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    const order: string[] = [];
    mockRestoreDataSnapshot.mockImplementation(async () => {
      order.push('restore');

      return { accountsRestored: 1 };
    });
    mockReplanRestoredReminders.mockImplementation(async () => {
      order.push('replan');
    });
    mockRestoreExportSecrets.mockImplementation(async () => {
      order.push('secrets');

      return [];
    });

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(order).toEqual(['restore', 'replan', 'secrets']);
  });

  // The data is already committed, so a credential that cannot be written is
  // not an import failure: the user reads a success, and which connections to
  // set up again.
  describe('when a credential could not be written after the data committed', () => {
    beforeEach(() => {
      mockRestoreExportSecrets.mockResolvedValue(['monobank', 'eodhd']);
    });

    it('resolves with the restored counts and the connections that need their key again', async () => {
      const { fileText, keyBase64 } = encryptedFixture();
      mockReadFile.mockResolvedValue(fileText);

      const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

      expect(summary).toEqual({
        accountsRestored: 1,
        holdingsRestored: 1,
        transactionsRestored: 1,
        languageRestored: null,
        unrestoredCredentials: ['monobank', 'eodhd'],
      });
    });

    it('still re-plans the reminders, refreshes the market data, and links the loans', async () => {
      const { fileText, keyBase64 } = encryptedFixture();
      mockReadFile.mockResolvedValue(fileText);

      await importData({ fileUri: '/tmp/x.kiko', keyBase64 });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockReplanRestoredReminders).toHaveBeenCalledTimes(1);
      expect(mockRecostStoredLots).toHaveBeenCalledTimes(1);
      expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
      expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
    });
  });

  it('never re-plans the reminders when the restore itself fails', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    mockRestoreDataSnapshot.mockRejectedValue(new Error('restore failed'));

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow();

    expect(mockReplanRestoredReminders).not.toHaveBeenCalled();
  });

  // The credentials are written after the data commits, so a malformed block
  // is refused before it, with the live data untouched.
  describe('a file whose credentials block is malformed', () => {
    const encryptedWithSecrets = (secrets: unknown): { fileText: string; keyBase64: string } => {
      const key = generateExportKey();
      const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify({ ...payload, secrets })), key);

      return { fileText: JSON.stringify(envelope), keyBase64: encodeBytesToBase64(key) };
    };

    const goodSecrets = {
      monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
      binanceCredentials: [{ accountId: 'a1', apiKey: 'k', secret: 's' }],
      eodhdKey: 'eodhd-key',
    };

    it.each([
      ['a string instead of an object', 'secrets'],
      ['a null block', null],
      ['monobankTokens that is not an array', { ...goodSecrets, monobankTokens: 'token' }],
      ['binanceCredentials that is a string', { ...goodSecrets, binanceCredentials: 'k' }],
      ['a token entry that is not an object', { ...goodSecrets, monobankTokens: ['token'] }],
      [
        'a token entry that is an array',
        { ...goodSecrets, monobankTokens: [['a1', 'mono-token']] },
      ],
      [
        'a token entry with no account',
        { ...goodSecrets, monobankTokens: [{ token: 'mono-token' }] },
      ],
      [
        'a token that is not a string',
        { ...goodSecrets, monobankTokens: [{ accountId: 'a1', token: 7 }] },
      ],
      [
        'a Binance entry without its secret',
        { ...goodSecrets, binanceCredentials: [{ accountId: 'a1', apiKey: 'k' }] },
      ],
      ['an eodhdKey that is not a string', { ...goodSecrets, eodhdKey: 12345 }],
    ])('refuses %s before the restore touches the data', async (_name, secrets) => {
      const { fileText, keyBase64 } = encryptedWithSecrets(secrets);
      mockReadFile.mockResolvedValue(fileText);

      await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow(
        'data-transfer/import',
      );

      expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
      expect(mockRestoreExportSecrets).not.toHaveBeenCalled();
      expect(mockReplanRestoredReminders).not.toHaveBeenCalled();
    });

    it('restores a well-formed credentials block, with or without an EODHD key', async () => {
      const withoutKey = {
        monobankTokens: goodSecrets.monobankTokens,
        binanceCredentials: goodSecrets.binanceCredentials,
      };

      for (const secrets of [goodSecrets, withoutKey]) {
        const { fileText, keyBase64 } = encryptedWithSecrets(secrets);
        mockReadFile.mockResolvedValue(fileText);

        await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

        expect(mockRestoreExportSecrets).toHaveBeenLastCalledWith(secrets, new Set(['a1']));
      }
    });

    // A file from an earlier build, or an export with nothing saved, carries
    // fewer of these, and a secret may name an account deleted before the
    // export: none of that is a reason to refuse the data.
    it.each([
      ['an empty block', {}],
      ['both arrays empty', { monobankTokens: [], binanceCredentials: [] }],
      ['no Binance array', { monobankTokens: goodSecrets.monobankTokens }],
      ['no Monobank array', { binanceCredentials: goodSecrets.binanceCredentials }],
      [
        'a secret for an account the file does not carry',
        { ...goodSecrets, monobankTokens: [{ accountId: 'ghost', token: 'mono-token' }] },
      ],
    ])('restores the data from a file with %s', async (_name, secrets) => {
      const { fileText, keyBase64 } = encryptedWithSecrets(secrets);
      mockReadFile.mockResolvedValue(fileText);

      const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

      expect(mockRestoreDataSnapshot).toHaveBeenCalledTimes(1);
      expect(mockRestoreExportSecrets).toHaveBeenCalledWith(secrets, new Set(['a1']));
      expect(summary.accountsRestored).toBe(1);
    });
  });

  it('costs the restored lots again before it resolves', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    const order: string[] = [];
    mockRestoreDataSnapshot.mockImplementation(async () => {
      order.push('restore');

      return { accountsRestored: 1 };
    });
    mockRecostStoredLots.mockImplementation(async () => {
      order.push('recost');
    });

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(order).toEqual(['restore', 'recost']);
  });

  it('never recosts when the restore fails', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    mockRestoreDataSnapshot.mockRejectedValue(new Error('restore failed'));

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow();

    expect(mockRecostStoredLots).not.toHaveBeenCalled();
  });

  it('decrypts a valid file, restores the snapshot and secrets, and returns row counts', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockRestoreDataSnapshot).toHaveBeenCalledWith(payload.tables);
    expect(mockRestoreExportSecrets).toHaveBeenCalledWith(undefined, new Set(['a1']));
    expect(summary).toEqual({
      accountsRestored: 1,
      holdingsRestored: 1,
      transactionsRestored: 1,
      languageRestored: null,
      unrestoredCredentials: [],
    });
  });

  // kiko-architecture: a restored foreign-currency/metal/crypto holding needs
  // its price/rate visible without an app restart — an import bulk-inserts
  // directly, bypassing the sync fan-out that normally triggers this.
  it('triggers the gated rate/metal refresh after a successful restore, unthrottled', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRefreshMarketData).toHaveBeenCalledWith({
      throttled: false,
      metals: true,
      shares: true,
    });
  });

  it("confirms the restored key's daily limit before the refresh, without the import waiting on it", async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    let confirmLimit: () => void = () => {};
    mockConfirmDailyLimit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          confirmLimit = resolve;
        }),
    );

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(summary.accountsRestored).toBe(1);
    expect(mockConfirmDailyLimit).toHaveBeenCalledWith();
    expect(mockRefreshMarketData).not.toHaveBeenCalled();

    confirmLimit();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('still refreshes when the daily limit check fails', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    mockConfirmDailyLimit.mockRejectedValue(new Error('settings read failed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Fire-and-forget, after a successful restore.
  it('triggers the loan auto-link matcher after a successful restore', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockRunLoanAutoLink).toHaveBeenCalledWith();
  });

  it('resolves with the row-count summary without waiting for the loan auto-link matcher to settle', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    let resolveAutoLink: () => void = () => {};
    mockRunLoanAutoLink.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAutoLink = resolve;
        }),
    );

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(summary.accountsRestored).toBe(1);

    resolveAutoLink();
  });

  // The refresh is a background nicety, not an import precondition —
  // `importData` must resolve with its row-count summary without sitting on
  // the network, even while the refresh is still pending.
  it('resolves with the row-count summary without waiting for the refresh to settle', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    let resolveRefresh: () => void = () => {};
    mockRefreshMarketData.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve(right(undefined));
        }),
    );

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(summary).toEqual({
      accountsRestored: 1,
      holdingsRestored: 1,
      transactionsRestored: 1,
      languageRestored: null,
      unrestoredCredentials: [],
    });

    resolveRefresh();
  });

  // The success alert is built from `t()` right after `importData` resolves
  // (import-data.screen.tsx `runImport`) — if the imported settings row
  // carries a different language, the caller needs it BEFORE building that
  // alert so it can switch i18n first. See the file header comment.
  // Migration 0044's restore mirror can insert one MORE account than the
  // file itself carried (a `crypto-from-<source>` account) — the summary
  // must reflect what was actually restored, not `payload.tables.accounts
  // .length`, or the Accounts screen would show one more account than the
  // success message just claimed.
  it("returns the actually-restored account count, not the file's own account count", async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    mockRestoreDataSnapshot.mockResolvedValue({ accountsRestored: 2 });

    const summary = await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(payload.tables.accounts).toHaveLength(1);
    expect(summary.accountsRestored).toBe(2);
  });

  it('returns the imported settings row language as languageRestored', async () => {
    const key = generateExportKey();
    const payloadWithLanguage = {
      ...payload,
      tables: { ...payload.tables, settings: [{ id: 1, language: 'uk' }] },
    };
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payloadWithLanguage)), key);
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const summary = await importData({
      fileUri: '/tmp/x.kiko',
      keyBase64: encodeBytesToBase64(key),
    });

    expect(summary.languageRestored).toBe('uk');
  });

  // The document picker / `keepLocalCopy` hand back a percent-encoded
  // `file://…` URI, but `RNFS.readFile` wants a plain filesystem path —
  // handed the URI literally, the real module throws and every import fails
  // as "invalid file". Assert the scheme is stripped and the rest
  // percent-decoded before `RNFS.readFile` is ever called.
  it('reads a percent-encoded file:// uri as a decoded, scheme-less path', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({
      fileUri: 'file:///var/mobile/Containers/Data/tmp/kiko%20export.kiko',
      keyBase64,
    });

    expect(mockReadFile).toHaveBeenCalledWith(
      '/var/mobile/Containers/Data/tmp/kiko export.kiko',
      'utf8',
    );
  });

  it('passes a plain, scheme-less path through unchanged', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/x.kiko', 'utf8');
  });

  it('throws a decrypt-prefixed error on the wrong key and never restores anything', async () => {
    const { fileText } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);
    const wrongKey = encodeBytesToBase64(generateExportKey());

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: wrongKey })).rejects.toThrow(
      'data-transfer/decrypt',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws a decrypt-prefixed error on a tampered file and never restores anything', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    const envelope = JSON.parse(fileText) as { ciphertext: string };
    const tamperedSuffix = envelope.ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA';
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -4)}${tamperedSuffix}`,
    };
    mockReadFile.mockResolvedValue(JSON.stringify(tampered));

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow(
      'data-transfer/decrypt',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('reads a version 1 file an earlier build wrote, and refuses a version no build writes', async () => {
    const { fileText, keyBase64 } = encryptedFixture();
    const envelope = JSON.parse(fileText) as { version: number };

    mockReadFile.mockResolvedValue(JSON.stringify({ ...envelope, version: 1 }));
    await importData({ fileUri: '/tmp/x.kiko', keyBase64 });
    expect(mockRestoreDataSnapshot).toHaveBeenCalledTimes(1);

    mockReadFile.mockResolvedValue(JSON.stringify({ ...envelope, version: 3 }));
    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64 })).rejects.toThrow(
      'data-transfer/import',
    );
    expect(mockRestoreDataSnapshot).toHaveBeenCalledTimes(1);
  });

  it('throws an import-prefixed error on unparseable JSON', async () => {
    mockReadFile.mockResolvedValue('not json');

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: 'anything' })).rejects.toThrow(
      'data-transfer/import',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws an import-prefixed error on a valid-JSON file with the wrong header', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ version: 99, format: 'not-kiko', nonce: '', ciphertext: '' }),
    );

    await expect(importData({ fileUri: '/tmp/x.kiko', keyBase64: 'anything' })).rejects.toThrow(
      'data-transfer/import',
    );
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws an import-prefixed error on a decrypted payload missing a required table and never restores anything', async () => {
    const key = generateExportKey();
    const malformedPayload = {
      exportedAt: 1,
      appVersion: '1.1.0',
      tables: { accounts: [], holdings: [] },
    };
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(malformedPayload)), key);
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    await expect(
      importData({ fileUri: '/tmp/x.kiko', keyBase64: encodeBytesToBase64(key) }),
    ).rejects.toThrow('data-transfer/import');
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });

  it('throws a decrypt-prefixed error on a garbled keyBase64 and never restores anything', async () => {
    const { fileText } = encryptedFixture();
    mockReadFile.mockResolvedValue(fileText);

    await expect(
      importData({ fileUri: '/tmp/x.kiko', keyBase64: '!!!not-base64!!!' }),
    ).rejects.toThrow('data-transfer/decrypt');
    expect(mockRestoreDataSnapshot).not.toHaveBeenCalled();
  });
});

import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';

import { decodeBase64ToBytes, encodeBytesToBase64 } from './base64/base64';
import { decryptEnvelope, encryptEnvelope } from './crypto/envelope';
import { generateExportKey } from './crypto/generate-key';
import type { ExportPayload } from './payload';

const fixturePayload = (): ExportPayload => ({
  exportedAt: 1700000000000,
  appVersion: '1.1.0',
  tables: {
    accounts: [
      {
        id: 'a1',
        name: 'Cash',
        kind: 'cash',
        institution: null,
        icon: null,
        color: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: 1700000000000,
      } as never,
    ],
    holdings: [
      {
        id: 'h1',
        accountId: 'a1',
        name: 'Cash',
        type: 'cash',
        currency: 'UAH',
        icon: null,
        color: null,
        balanceMinorUnits: 10000,
        syncedBalanceMinorUnits: null,
        metadata: null,
        sortOrder: 0,
        closedAt: null,
        createdAt: 1700000000000,
      } as never,
    ],
    transactions: [
      {
        id: 't1',
        holdingId: 'h1',
        amountMinorUnits: -500,
        time: 1700000000000,
        description: 'Coffee',
        category: 'food',
        mcc: null,
        hold: null,
        counterIban: null,
        exchangeCounterpartHoldingId: null,
        changeGroupId: null,
        comment: null,
        source: 'manual',
        externalId: null,
        createdAt: 1700000000000,
      } as never,
    ],
    currencyRates: [
      {
        base: 'UAH',
        quote: 'USD',
        rate: '0.024',
        source: 'monobank',
        fetchedAt: 1700000000000,
      } as never,
    ],
    currencyRateHistory: [
      { base: 'UAH', quote: 'USD', day: 1700000000000, rate: '0.024', source: 'nbu' } as never,
    ],
    settings: [
      {
        id: 1,
        baseCurrency: 'UAH',
        lastSyncAt: null,
        defaultCategoryKey: 'other',
        lockEnabled: false,
        lockGraceSeconds: 30,
        language: null,
        appearance: 'system',
        lastSyncDisplayAt: null,
        lastFullSyncAt: null,
        trendCategoryKeys: null,
        trendFilter: null,
        failedSyncMonobankIds: null,
      } as never,
    ],
    syncState: [
      {
        accountId: 'a1',
        lastSyncAt: null,
        lastFullSyncAt: null,
        lastSyncDisplayAt: null,
        failedSyncMonobankIds: null,
      } as never,
    ],
    categories: [
      { key: 'food', title: 'Food', icon: 'fork.knife', color: null, sortOrder: 0 } as never,
    ],
    categoryOverrides: [
      {
        normalizedName: 'starbucks',
        category: 'food',
        displayName: 'Starbucks',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      } as never,
    ],
  },
  secrets: {
    dbKeyHex: 'a'.repeat(64),
    monobankTokens: [{ accountId: 'a1', token: 'mono-token' }],
    binanceCredentials: [],
  },
});

describe('data-transfer full-pipeline round trip', () => {
  it('reproduces the exact payload through encrypt -> decrypt', () => {
    const key = generateExportKey();
    const payload = fixturePayload();

    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payload)), key);
    const roundTripped = JSON.parse(bytesToUtf8(decryptEnvelope(envelope, key))) as ExportPayload;

    expect(roundTripped).toEqual(payload);
  });

  it('round-trips the base64 key through the same display/paste path the UI uses', () => {
    const key = generateExportKey();
    expect(decodeBase64ToBytes(encodeBytesToBase64(key))).toEqual(key);
  });

  it('rejects decryption with the wrong key', () => {
    const key = generateExportKey();
    const wrongKey = generateExportKey();
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(fixturePayload())), key);

    expect(() => decryptEnvelope(envelope, wrongKey)).toThrow('data-transfer/decrypt');
  });

  it('rejects a tampered ciphertext', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(fixturePayload())), key);
    const tamperedBytes = decodeBase64ToBytes(envelope.ciphertext);
    tamperedBytes[0] ^= 0xff;
    const tampered = { ...envelope, ciphertext: encodeBytesToBase64(tamperedBytes) };

    expect(() => decryptEnvelope(tampered, key)).toThrow('data-transfer/decrypt');
  });
});

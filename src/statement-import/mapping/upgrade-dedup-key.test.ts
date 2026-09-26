import { computeDedupKeyBase } from './mapping';
import { upgradeLegacyDedupKey } from './upgrade-dedup-key';

const base = computeDedupKeyBase('holding-1', 1_700_000_000, -4_599, 'Top up');

describe('upgradeLegacyDedupKey', () => {
  it('keeps an occurrence-0 key unchanged (already the stable, non-legacy form)', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up',
      source: 'import',
      externalId: base,
    });

    expect(upgraded).toBeNull();
  });

  it('rewrites a legacy occurrence-N key (base + space + digits) to the ␟ separator', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up',
      source: 'import',
      externalId: `${base} 1`,
    });

    expect(upgraded).toBe(`${base}␟1`);
  });

  it('leaves a description that itself ends in a digit unchanged (its own occurrence-0 key)', () => {
    const ownBase = computeDedupKeyBase('holding-1', 1_700_000_000, -4_599, 'Top up 1');
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up 1',
      source: 'import',
      externalId: ownBase,
    });

    expect(upgraded).toBeNull();
  });

  it('leaves an edited description unchanged (the recomputed base no longer matches)', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up (edited note)',
      source: 'import',
      externalId: `${base} 1`,
    });

    expect(upgraded).toBeNull();
  });

  it('leaves a bank-issued external id unchanged', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up',
      source: 'import',
      externalId: 'bank-issued-id-42',
    });

    expect(upgraded).toBeNull();
  });

  it('leaves a non-import-source row unchanged even if it coincidentally matches the legacy shape', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up',
      source: 'manual',
      externalId: `${base} 1`,
    });

    expect(upgraded).toBeNull();
  });

  it('leaves a null externalId unchanged', () => {
    const upgraded = upgradeLegacyDedupKey({
      holdingId: 'holding-1',
      time: 1_700_000_000_000,
      amountMinorUnits: -4_599,
      description: 'Top up',
      source: 'import',
      externalId: null,
    });

    expect(upgraded).toBeNull();
  });
});

import {
  NOT_IMPORTED_KINDS,
  notImportedEntry,
  notImportedKindOf,
  type ParsedExchangeState,
  parseExchangeState,
} from './walk-state';

type ReadableState = Extract<ParsedExchangeState, { kind: 'parsed' }>;

const readableOf = (rest: Record<string, unknown>): ReadableState => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, ...rest }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state not-imported test: a state that should parse');
  }

  return parsed;
};

describe('the not-imported list of a parsed state', () => {
  it('reads a state that holds no list as an empty one, and names nothing', () => {
    const parsed = readableOf({});

    expect(parsed.notImported).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
  });

  it('counts a known entry', () => {
    const parsed = readableOf({ notImported: ['convert-unrecognized:42:1700000000000'] });

    expect(parsed.notImported).toEqual(['convert-unrecognized:42:1700000000000']);
    expect(parsed.unreadable).toEqual([]);
  });

  it('reads an entry of every known kind', () => {
    const entries = NOT_IMPORTED_KINDS.map((kind) => notImportedEntry(kind, '7', 1_000));

    expect(readableOf({ notImported: entries }).notImported).toEqual(entries);
  });

  it('keeps an entry once when the list holds it twice, in the stored order', () => {
    const parsed = readableOf({
      notImported: ['p2p-sale:1:2', 'convert-unrecognized:3:4', 'p2p-sale:1:2'],
    });

    expect(parsed.notImported).toEqual(['p2p-sale:1:2', 'convert-unrecognized:3:4']);
    expect(parsed.unreadable).toEqual([]);
  });

  it.each([
    ['text', 'x'],
    ['an object', {}],
    ['null', null],
  ])('reads a list stored as %s as empty, names it, and keeps the siblings', (_label, stored) => {
    const parsed = readableOf({ notImported: stored, balanceSyncedAt: 5_000 });

    expect(parsed.notImported).toEqual([]);
    expect(parsed.unreadable).toEqual(['notImported']);
    expect(parsed.balanceSyncedAt).toBe(5_000);
  });

  it('drops each entry it cannot read beside a good one, and names it by index', () => {
    const parsed = readableOf({ notImported: ['bybit-x:1:2', 5, '', 'p2p-sale:1:2'] });

    expect(parsed.notImported).toEqual(['p2p-sale:1:2']);
    expect(parsed.unreadable).toEqual(['notImported.0', 'notImported.1', 'notImported.2']);
  });

  it('drops a kind name that has no record id and time after it', () => {
    const parsed = readableOf({ notImported: ['p2p-sale'] });

    expect(parsed.notImported).toEqual([]);
    expect(parsed.unreadable).toEqual(['notImported.0']);
  });

  it('leaves a malformed top level malformed', () => {
    expect(parseExchangeState('{"version":2,"walks":{},"notImported":["p2p-sale:1:2"]}')).toEqual({
      kind: 'malformed',
    });
  });
});

describe('a not-imported entry', () => {
  it('is its kind, the record id and the record time joined by colons', () => {
    expect(notImportedEntry('p2p-amount', 'A-1', 1_700_000_000_000)).toBe(
      'p2p-amount:A-1:1700000000000',
    );
  });

  it.each(NOT_IMPORTED_KINDS)('names its kind: %s', (kind) => {
    expect(notImportedKindOf(notImportedEntry(kind, '9', 5))).toBe(kind);
  });

  it.each(['bybit-x:1:2', '', 'p2p-sale', ':1:2'])('names no kind for %j', (entry) => {
    expect(notImportedKindOf(entry)).toBeUndefined();
  });
});

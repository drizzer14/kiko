import { type ParsedExchangeState, parseExchangeState } from './walk-state';

type ReadableState = Extract<ParsedExchangeState, { kind: 'parsed' }>;

const readableOf = (rest: Record<string, unknown>): ReadableState => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, ...rest }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state funding test: a state that should parse');
  }

  return parsed;
};

describe('the Funding ledger walk entry', () => {
  it('reads like any other walk: its own marks, and the empty marks when it holds none', () => {
    expect(
      readableOf({ walks: { fundingLedger: { cursor: 900, pending: [{ start: 1, end: 3 }] } } })
        .walks.fundingLedger,
    ).toMatchObject({ cursor: 900, pending: [{ start: 1, end: 3 }] });
    expect(readableOf({}).walks.fundingLedger).toMatchObject({
      cursor: null,
      rescan: null,
      pending: [],
    });
  });
});

describe('the held count of the Funding ledger', () => {
  it('is none when the state holds none, and nothing is named', () => {
    const parsed = readableOf({});

    expect(parsed.fundingHeld).toBe(0);
    expect(parsed.unreadable).toEqual([]);
  });

  it('is read as stored', () => {
    expect(readableOf({ fundingHeld: 3 }).fundingHeld).toBe(3);
  });

  it.each([
    ['text', '3'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['zero', 0],
    ['a boolean', true],
    ['null', null],
  ])('reads a count stored as %s as none and names it', (_label, stored) => {
    const parsed = readableOf({ fundingHeld: stored });

    expect(parsed.fundingHeld).toBe(0);
    expect(parsed.unreadable).toEqual(['fundingHeld']);
  });
});

describe('the left-out flag of the Funding ledger', () => {
  it('is false when the state holds none, and nothing is named', () => {
    const parsed = readableOf({});

    expect(parsed.fundingLeftOut).toBe(false);
    expect(parsed.unreadable).toEqual([]);
  });

  it('is read as stored when it is true', () => {
    expect(readableOf({ fundingLeftOut: true }).fundingLeftOut).toBe(true);
  });

  it.each([
    ['text', 'true'],
    ['false', false],
    ['a number', 1],
    ['null', null],
  ])('reads a flag stored as %s as false and names it', (_label, stored) => {
    const parsed = readableOf({ fundingLeftOut: stored });

    expect(parsed.fundingLeftOut).toBe(false);
    expect(parsed.unreadable).toEqual(['fundingLeftOut']);
  });
});

import { parseExchangeState } from './walk-state';

const parsedNotes = (balanceNotes?: unknown) => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, balanceNotes }));

  return parsed.kind === 'parsed' ? parsed : undefined;
};

describe('the stored balance notes', () => {
  it('reads the borrowed coins, the open-order coins and the refused mark of each wallet', () => {
    expect(
      parsedNotes({
        unified: { borrowed: ['ETH', 'BTC'], openOrder: ['SOL'] },
        fund: { refused: true },
      })?.balanceNotes,
    ).toEqual({
      unified: { borrowed: ['ETH', 'BTC'], openOrder: ['SOL'], refused: false },
      fund: { borrowed: [], openOrder: [], refused: true },
    });
  });

  it('reads none for a state that stored no notes, with nothing unreadable', () => {
    expect(parsedNotes()).toMatchObject({ balanceNotes: {}, unreadable: [] });
  });

  it('reads an empty entry as a wallet with nothing to note', () => {
    expect(parsedNotes({ unified: {} })?.balanceNotes).toEqual({
      unified: { borrowed: [], openOrder: [], refused: false },
    });
  });

  it.each([
    ['text', { borrowed: 'ETH' }],
    ['a list with a number', { borrowed: ['ETH', 5] }],
    ['null', { borrowed: null }],
  ])('reads a borrowed list that is %s as none', (_title, entry) => {
    expect(parsedNotes({ unified: entry })?.balanceNotes.unified?.borrowed).toEqual([]);
  });

  it.each([
    ['text', { openOrder: 'ETH' }],
    ['a list with a number', { openOrder: ['ETH', 5] }],
    ['null', { openOrder: null }],
  ])('reads an open-order list that is %s as none', (_title, entry) => {
    expect(parsedNotes({ unified: entry })?.balanceNotes.unified?.openOrder).toEqual([]);
  });

  // The parse names only the keys it reads, so an entry that holds a key no code here names
  // (`earnLeftOut`, a count another build may store) reads as the entry without it.
  it('reads a wallet entry with a key this build never names as one without it, with nothing unreadable', () => {
    const named = { borrowed: ['ETH'], openOrder: ['BTC'], refused: true };

    expect(
      parsedNotes({ unified: { ...named, earnLeftOut: 2 }, fund: { earnLeftOut: 1 } }),
    ).toEqual(parsedNotes({ unified: named, fund: {} }));
    expect(parsedNotes({ unified: { ...named, earnLeftOut: 2 } })).toMatchObject({
      kind: 'parsed',
      unreadable: [],
    });
  });

  it.each([
    ['text', 'true'],
    ['a number', 1],
    ['false', false],
  ])('reads a refused mark that is %s as not refused', (_title, refused) => {
    expect(parsedNotes({ fund: { refused } })?.balanceNotes.fund?.refused).toBe(false);
  });

  it('drops an entry that is no record and names it, keeping the others', () => {
    expect(parsedNotes({ unified: { borrowed: ['ETH'] }, fund: 'x', earn: ['y'] })).toMatchObject({
      balanceNotes: { unified: { borrowed: ['ETH'], refused: false } },
      unreadable: ['balanceNotes.fund', 'balanceNotes.earn'],
    });
  });

  it.each([
    ['a list', ['x']],
    ['a number', 7],
    ['text', 'x'],
    ['null', null],
  ])('reads none and names the notes unreadable when they are %s', (_title, notes) => {
    expect(parsedNotes(notes)).toMatchObject({
      balanceNotes: {},
      unreadable: ['balanceNotes'],
    });
  });
});

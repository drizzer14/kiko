import { parseExchangeState } from './walk-state';

const parsedNotes = (balanceNotes?: unknown) => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, balanceNotes }));

  return parsed.kind === 'parsed' ? parsed : undefined;
};

describe('the stored balance notes', () => {
  it('reads the borrowed coins and the refused mark of each wallet', () => {
    expect(
      parsedNotes({
        unified: { borrowed: ['ETH', 'BTC'] },
        fund: { refused: true },
      })?.balanceNotes,
    ).toEqual({
      unified: { borrowed: ['ETH', 'BTC'], refused: false },
      fund: { borrowed: [], refused: true },
    });
  });

  it('reads none for a state that stored no notes, with nothing unreadable', () => {
    expect(parsedNotes()).toMatchObject({ balanceNotes: {}, unreadable: [] });
  });

  it('reads an empty entry as a wallet with nothing to note', () => {
    expect(parsedNotes({ unified: {} })?.balanceNotes).toEqual({
      unified: { borrowed: [], refused: false },
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

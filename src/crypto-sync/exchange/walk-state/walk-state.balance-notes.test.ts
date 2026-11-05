import { parseExchangeState } from './walk-state';

const parsedNotes = (balanceNotes?: unknown) => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, balanceNotes }));

  return parsed.kind === 'parsed' ? parsed : undefined;
};

describe('the stored balance notes', () => {
  it('reads the borrowed coins, the left-out count and the refused mark of each wallet', () => {
    expect(
      parsedNotes({
        unified: { borrowed: ['ETH', 'BTC'], earnLeftOut: 2 },
        fund: { refused: true },
      })?.balanceNotes,
    ).toEqual({
      unified: { borrowed: ['ETH', 'BTC'], earnLeftOut: 2, refused: false },
      fund: { borrowed: [], earnLeftOut: 0, refused: true },
    });
  });

  it('reads none for a state that stored no notes, with nothing unreadable', () => {
    expect(parsedNotes()).toMatchObject({ balanceNotes: {}, unreadable: [] });
  });

  it('reads an empty entry as a wallet with nothing to note', () => {
    expect(parsedNotes({ unified: {} })?.balanceNotes).toEqual({
      unified: { borrowed: [], earnLeftOut: 0, refused: false },
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
    ['text', '2'],
    ['negative', -1],
    ['a fraction', 1.5],
    ['null', null],
  ])('reads a left-out count that is %s as zero', (_title, earnLeftOut) => {
    expect(parsedNotes({ unified: { earnLeftOut } })?.balanceNotes.unified?.earnLeftOut).toBe(0);
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
      balanceNotes: { unified: { borrowed: ['ETH'], earnLeftOut: 0, refused: false } },
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

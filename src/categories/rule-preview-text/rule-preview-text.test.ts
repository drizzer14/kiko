import { i18n } from '@kiko/i18n/init';
import type { TFunction } from 'i18next';

type Preview = { count: number; names: readonly string[] };
type RulePreviewTextModule = {
  NAMES_SHOWN: number;
  ruleMoveMessage: (preview: Preview, categoryTitle: string, t: TFunction) => string;
};

// The module does not exist yet, so a static import would fail the whole file at load; a lookup at
// call time fails each test on its own.
const rulePreviewText = (): RulePreviewTextModule => require('./rule-preview-text');

const english = i18n.getFixedT('en');
const ukrainian = i18n.getFixedT('uk');

const NAMES = ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Name 5', 'Name 6', 'Name 7'];

describe('ruleMoveMessage', () => {
  it('shows at most five names and the count of the rest', () => {
    const { NAMES_SHOWN, ruleMoveMessage } = rulePreviewText();

    const message = ruleMoveMessage({ count: 9, names: NAMES }, 'Food', english);

    expect(NAMES_SHOWN).toBe(5);
    expect(message).toContain('Name 1, Name 2, Name 3, Name 4, Name 5');
    expect(message).toContain('and 2 more');
    expect(message).not.toContain('Name 6');
    expect(message).not.toContain('Name 7');
  });

  it('lists all names with no rest line when there are no more than five', () => {
    const { ruleMoveMessage } = rulePreviewText();

    const message = ruleMoveMessage({ count: 5, names: NAMES.slice(0, 5) }, 'Food', english);

    expect(message).toContain('Name 5');
    expect(message).not.toContain('more');
  });

  it('quotes each name through common.listedName in uk', () => {
    const { ruleMoveMessage } = rulePreviewText();

    const message = ruleMoveMessage(
      { count: 3, names: ['ATB 0212', 'АТБ Маркет'] },
      'Їжа',
      ukrainian,
    );

    expect(message).toContain('«ATB 0212», «АТБ Маркет»');
  });

  it.each([
    [1, '1 транзакція перейде'],
    [2, '2 транзакції перейдуть'],
    [5, '5 транзакцій перейде'],
    [21, '21 транзакція перейде'],
  ])('uses the plural of the count %s in uk', (count, expected) => {
    const { ruleMoveMessage } = rulePreviewText();

    expect(ruleMoveMessage({ count, names: ['ATB 0212'] }, 'Їжа', ukrainian)).toContain(expected);
  });

  it('uses the singular for one transaction in en', () => {
    const { ruleMoveMessage } = rulePreviewText();

    expect(ruleMoveMessage({ count: 1, names: ['ATB 0212'] }, 'Food', english)).toContain(
      '1 transaction moves to "Food"',
    );
    expect(ruleMoveMessage({ count: 2, names: ['ATB 0212'] }, 'Food', english)).toContain(
      '2 transactions move to "Food"',
    );
  });

  it('says no rows move for a count of 0', () => {
    const { ruleMoveMessage } = rulePreviewText();

    const none = ruleMoveMessage({ count: 0, names: [] }, 'Food', english);
    const some = ruleMoveMessage({ count: 3, names: ['ATB 0212'] }, 'Food', english);

    expect(none).toBe('No existing transactions move. New ones will go to "Food".');
    expect(none).not.toContain('0 transactions');
    expect(none).not.toContain(':');
    expect(some).toContain('3 transactions');
  });
});

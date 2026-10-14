import { en, uk } from '@kiko/i18n/locales';
import { TITLE_KEYS } from '@kiko/i18n/locales/title-keys';
import { flattenCatalog } from '@kiko/i18n/locales/flatten-catalog';

import { HELP_GROUPS, HELP_TOPICS, helpTopicById } from './help-topics';

const catalogPaths = new Set(flattenCatalog(en).map(({ path }) => path));

const stepKeysInCatalog = (topicId: string): string[] =>
  [...catalogPaths].filter((path) => path.startsWith(`help.topics.${topicId}.steps.`));

// The Home FAB's glyph is a quoted literal, not a catalogue string.
const QUOTED_LITERALS = new Set(['+']);

const valueByPath = (catalogue: unknown): Map<string, string> =>
  new Map(flattenCatalog(catalogue).map(({ path, value }) => [path, value]));

// Every catalogue value a step may quote. The help topics are left out so a step cannot vouch for
// its own quote.
const labelsOf = (catalogue: unknown): Set<string> =>
  new Set(
    flattenCatalog(catalogue)
      .filter(({ path }) => !path.startsWith('help.topics.'))
      .map(({ value }) => value),
  );

const quotedSpans = (text: string, quote: RegExp): string[] =>
  [...text.matchAll(quote)].map(([, inner]) => inner);

describe('help topic registry', () => {
  it('has unique topic ids', () => {
    expect(new Set(HELP_TOPICS.map(({ id }) => id)).size).toBe(HELP_TOPICS.length);
  });

  it.each(HELP_TOPICS)('has every string of $id in the en catalogue', (topic) => {
    expect(topic.stepKeys.length).toBeGreaterThan(0);

    for (const key of [topic.titleKey, topic.rowLabelKey, ...topic.stepKeys]) {
      expect(catalogPaths.has(key)).toBe(true);
    }
  });

  it.each(HELP_TOPICS)('has the title of $id in TITLE_KEYS', (topic) => {
    expect(TITLE_KEYS.has(topic.titleKey)).toBe(true);
  });

  it.each(HELP_TOPICS)('lists every step of $id that the catalogue holds, in order', (topic) => {
    expect(topic.stepKeys).toEqual(stepKeysInCatalog(topic.id));
    expect(topic.stepKeys).toEqual(
      topic.stepKeys.map((_, index) => `help.topics.${topic.id}.steps.${index + 1}`),
    );
  });

  it.each([
    ['addAccount', 5],
    ['connectMonobank', 5],
    ['connectCrypto', 5],
    ['importStatement', 6],
    ['setReminder', 4],
    ['addHolding', 5],
    ['trackProperty', 5],
    ['trackLoan', 6],
    ['addTransaction', 4],
    ['editTransaction', 3],
    ['useTemplates', 4],
    ['manageCategories', 5],
    ['categoryRules', 5],
    ['viewStatistics', 4],
    ['backupData', 4],
    ['restoreData', 4],
    ['systemSettings', 4],
  ] as const)('gives the %s topic %i steps', (topicId, count) => {
    expect(helpTopicById(topicId).stepKeys).toHaveLength(count);
  });

  it.each([
    ['addAccount', 'addAccount'],
    ['connectMonobank', 'addAccount'],
    ['connectCrypto', 'addAccount'],
    ['importStatement', null],
    ['setReminder', 'openReminders'],
    ['addHolding', null],
    ['trackProperty', 'addAccount'],
    ['trackLoan', 'addAccount'],
    ['addTransaction', 'addTransaction'],
    ['editTransaction', null],
    ['useTemplates', 'openTemplates'],
    ['manageCategories', 'openCategories'],
    ['categoryRules', 'openCategories'],
    ['viewStatistics', null],
    ['backupData', 'openExportData'],
    ['restoreData', 'openImportData'],
    ['systemSettings', 'openSystem'],
  ] as const)('gives the %s topic the %s action', (topicId, action) => {
    expect(helpTopicById(topicId)).toMatchObject({ id: topicId, action });
  });
});

describe('help group registry', () => {
  it('lists the groups in order, each with its topics in order', () => {
    expect(HELP_GROUPS.map((group) => [group.id, group.topics.map((topic) => topic.id)])).toEqual([
      [
        'accounts',
        ['addAccount', 'connectMonobank', 'connectCrypto', 'importStatement', 'setReminder'],
      ],
      ['holdings', ['addHolding', 'trackProperty', 'trackLoan']],
      ['transactions', ['addTransaction', 'editTransaction', 'useTemplates']],
      ['categories', ['manageCategories', 'categoryRules']],
      ['statistics', ['viewStatistics']],
      ['settings', ['backupData', 'restoreData', 'systemSettings']],
    ]);
    expect(HELP_TOPICS).toHaveLength(17);
  });

  it('puts every topic in exactly one group', () => {
    const grouped = HELP_GROUPS.flatMap((group) => group.topics);

    expect(grouped).toHaveLength(HELP_TOPICS.length);
    expect(new Set(grouped)).toEqual(new Set(HELP_TOPICS));
  });

  it.each(HELP_GROUPS)('has at least one topic in the $id group', (group) => {
    expect(group.topics.length).toBeGreaterThan(0);
  });

  it.each(HELP_GROUPS)(
    'has the title of the $id group in the catalogue and TITLE_KEYS',
    (group) => {
      expect(catalogPaths.has(group.titleKey)).toBe(true);
      expect(TITLE_KEYS.has(group.titleKey)).toBe(true);
    },
  );

  it('has unique group ids', () => {
    expect(new Set(HELP_GROUPS.map(({ id }) => id)).size).toBe(HELP_GROUPS.length);
  });
});

describe('the labels a help step quotes', () => {
  const enValues = valueByPath(en);
  const ukValues = valueByPath(uk);
  const enLabels = labelsOf(en);
  const ukLabels = labelsOf(uk);

  it('reads a quoted label out of a step', () => {
    expect(quotedSpans('Tap "Save", then "+".', /"([^"]*)"/g)).toEqual(['Save', '+']);
    expect(quotedSpans('Натисніть «Зберегти».', /«([^»]*)»/g)).toEqual(['Зберегти']);
  });

  it.each(HELP_TOPICS)('quotes only en catalogue strings in the $id steps', (topic) => {
    const unknown = topic.stepKeys
      .flatMap((key) => quotedSpans(enValues.get(key) ?? '', /"([^"]*)"/g))
      .filter((span) => !(enLabels.has(span) || QUOTED_LITERALS.has(span)));

    expect(unknown).toEqual([]);
  });

  it.each(HELP_TOPICS)('quotes only uk catalogue strings in the $id steps', (topic) => {
    const unknown = topic.stepKeys
      .flatMap((key) => quotedSpans(ukValues.get(key) ?? '', /«([^»]*)»/g))
      .filter((span) => !(ukLabels.has(span) || QUOTED_LITERALS.has(span)));

    expect(unknown).toEqual([]);
  });

  it('finds the quoted labels of the steps at all', () => {
    const quoted = HELP_TOPICS.flatMap((topic) =>
      topic.stepKeys.flatMap((key) => quotedSpans(enValues.get(key) ?? '', /"([^"]*)"/g)),
    );

    expect(quoted.length).toBeGreaterThan(50);
    expect(quoted).toContain('Export Data');
  });
});

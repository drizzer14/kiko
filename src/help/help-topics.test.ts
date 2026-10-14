import { en } from '@kiko/i18n/locales';
import { TITLE_KEYS } from '@kiko/i18n/locales/title-keys';
import { flattenCatalog } from '@kiko/i18n/locales/flatten-catalog';

import { HELP_GROUPS, HELP_TOPICS, helpTopicById } from './help-topics';

const catalogPaths = new Set(flattenCatalog(en).map(({ path }) => path));

const stepKeysInCatalog = (topicId: string): string[] =>
  flattenCatalog(en)
    .map(({ path }) => path)
    .filter((path) => path.startsWith(`help.topics.${topicId}.steps.`));

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
    ['manageCategories', 4],
  ] as const)('gives the %s topic %i steps', (topicId, count) => {
    expect(helpTopicById(topicId).stepKeys).toHaveLength(count);
  });

  it.each([
    ['addAccount', 'addAccount'],
    ['manageCategories', 'openCategories'],
  ] as const)('gives the %s topic the %s action', (topicId, action) => {
    expect(helpTopicById(topicId)).toMatchObject({ id: topicId, action });
  });
});

describe('help group registry', () => {
  it('lists the groups in order, each with its topics in order', () => {
    expect(HELP_GROUPS.map((group) => [group.id, group.topics.map((topic) => topic.id)])).toEqual([
      ['accounts', ['addAccount']],
      ['categories', ['manageCategories']],
    ]);
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

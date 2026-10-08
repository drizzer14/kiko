import { en } from '@kiko/i18n/locales';
import { TITLE_KEYS } from '@kiko/i18n/locales/title-keys';
import { flattenCatalog } from '@kiko/i18n/locales/flatten-catalog';

import { HELP_TOPICS, helpTopicById } from './help-topics';

const catalogPaths = new Set(flattenCatalog(en).map(({ path }) => path));

describe('help topic registry', () => {
  it('lists the add-account and manage-categories topics', () => {
    expect(HELP_TOPICS.map(({ id }) => id)).toEqual(['addAccount', 'manageCategories']);
  });

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

  it('gives the add-account topic five steps and the manage-categories topic four', () => {
    expect(helpTopicById('addAccount').stepKeys).toHaveLength(5);
    expect(helpTopicById('manageCategories').stepKeys).toHaveLength(4);
  });

  it('finds a topic by its id', () => {
    expect(helpTopicById('manageCategories')).toMatchObject({
      id: 'manageCategories',
      action: 'openCategories',
    });
    expect(helpTopicById('addAccount').action).toBe('addAccount');
  });
});

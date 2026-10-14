import type { ParseKeys } from 'i18next';

export type HelpTopicId = 'addAccount' | 'manageCategories';

type HelpGroupId = 'accounts' | 'categories';

type HelpAction = 'addAccount' | 'openCategories';

type HelpTopic = {
  id: HelpTopicId;
  titleKey: ParseKeys;
  rowLabelKey: ParseKeys;
  stepKeys: readonly ParseKeys[];
  // `null` means the topic page has no footer button.
  action: HelpAction | null;
};

type HelpGroupEntry = {
  id: HelpGroupId;
  titleKey: ParseKeys;
  topicIds: readonly HelpTopicId[];
};

// Keyed by id so a topic that is added to `HelpTopicId` without an entry here fails `tsc`.
const topicsById = {
  addAccount: {
    id: 'addAccount',
    titleKey: 'help.topics.addAccount.title',
    rowLabelKey: 'help.topics.addAccount.rowLabel',
    stepKeys: [
      'help.topics.addAccount.steps.1',
      'help.topics.addAccount.steps.2',
      'help.topics.addAccount.steps.3',
      'help.topics.addAccount.steps.4',
      'help.topics.addAccount.steps.5',
    ],
    action: 'addAccount',
  },
  manageCategories: {
    id: 'manageCategories',
    titleKey: 'help.topics.manageCategories.title',
    rowLabelKey: 'help.topics.manageCategories.rowLabel',
    stepKeys: [
      'help.topics.manageCategories.steps.1',
      'help.topics.manageCategories.steps.2',
      'help.topics.manageCategories.steps.3',
      'help.topics.manageCategories.steps.4',
    ],
    action: 'openCategories',
  },
} satisfies Record<HelpTopicId, HelpTopic>;

// Derived from the record so the visible list cannot drift from it. The order is the record's
// insertion order, which is the row order on the Help page.
export const HELP_TOPICS: readonly HelpTopic[] = Object.values(topicsById);

export const helpTopicById = (id: HelpTopicId): HelpTopic => topicsById[id];

// Keyed by id so a group that is added to `HelpGroupId` without an entry here fails `tsc`.
const groupsById = {
  accounts: {
    id: 'accounts',
    titleKey: 'help.groups.accounts.title',
    topicIds: ['addAccount'],
  },
  categories: {
    id: 'categories',
    titleKey: 'help.groups.categories.title',
    topicIds: ['manageCategories'],
  },
} satisfies Record<HelpGroupId, HelpGroupEntry>;

// The record's insertion order is the section order on the Help page, and each group's
// `topicIds` order is its row order.
export const HELP_GROUPS: readonly {
  id: HelpGroupId;
  titleKey: ParseKeys;
  topics: readonly HelpTopic[];
}[] = Object.values(groupsById).map(({ id, titleKey, topicIds }) => ({
  id,
  titleKey,
  topics: topicIds.map(helpTopicById),
}));

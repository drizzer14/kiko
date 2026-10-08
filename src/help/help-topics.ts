import type { ParseKeys } from 'i18next';

export type HelpTopicId = 'addAccount' | 'manageCategories';

type HelpAction = 'addAccount' | 'openCategories';

type HelpTopic = {
  id: HelpTopicId;
  titleKey: ParseKeys;
  rowLabelKey: ParseKeys;
  stepKeys: readonly ParseKeys[];
  action: HelpAction;
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

// The list order is the row order on the Help page.
export const HELP_TOPICS: readonly HelpTopic[] = [
  topicsById.addAccount,
  topicsById.manageCategories,
];

export const helpTopicById = (id: HelpTopicId): HelpTopic => topicsById[id];

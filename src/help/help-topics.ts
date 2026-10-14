import type { ParseKeys } from 'i18next';

export type HelpTopicId =
  | 'addAccount'
  | 'connectMonobank'
  | 'connectCrypto'
  | 'importStatement'
  | 'setReminder'
  | 'addHolding'
  | 'trackProperty'
  | 'trackLoan'
  | 'addTransaction'
  | 'editTransaction'
  | 'useTemplates'
  | 'manageCategories'
  | 'categoryRules'
  | 'viewStatistics'
  | 'backupData'
  | 'restoreData'
  | 'systemSettings';

type HelpGroupId =
  | 'accounts'
  | 'holdings'
  | 'transactions'
  | 'categories'
  | 'statistics'
  | 'settings';

export type HelpAction =
  | 'addAccount'
  | 'addBankAccount'
  | 'addCryptoAccount'
  | 'addProperty'
  | 'addLoan'
  | 'addTransaction'
  | 'openCategories'
  | 'openTemplates'
  | 'openReminders'
  | 'openStatistics'
  | 'openExportData'
  | 'openImportData'
  | 'openSystem';

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
  connectMonobank: {
    id: 'connectMonobank',
    titleKey: 'help.topics.connectMonobank.title',
    rowLabelKey: 'help.topics.connectMonobank.rowLabel',
    stepKeys: [
      'help.topics.connectMonobank.steps.1',
      'help.topics.connectMonobank.steps.2',
      'help.topics.connectMonobank.steps.3',
      'help.topics.connectMonobank.steps.4',
      'help.topics.connectMonobank.steps.5',
    ],
    action: 'addBankAccount',
  },
  connectCrypto: {
    id: 'connectCrypto',
    titleKey: 'help.topics.connectCrypto.title',
    rowLabelKey: 'help.topics.connectCrypto.rowLabel',
    stepKeys: [
      'help.topics.connectCrypto.steps.1',
      'help.topics.connectCrypto.steps.2',
      'help.topics.connectCrypto.steps.3',
      'help.topics.connectCrypto.steps.4',
      'help.topics.connectCrypto.steps.5',
    ],
    action: 'addCryptoAccount',
  },
  importStatement: {
    id: 'importStatement',
    titleKey: 'help.topics.importStatement.title',
    rowLabelKey: 'help.topics.importStatement.rowLabel',
    stepKeys: [
      'help.topics.importStatement.steps.1',
      'help.topics.importStatement.steps.2',
      'help.topics.importStatement.steps.3',
      'help.topics.importStatement.steps.4',
      'help.topics.importStatement.steps.5',
      'help.topics.importStatement.steps.6',
    ],
    action: null,
  },
  setReminder: {
    id: 'setReminder',
    titleKey: 'help.topics.setReminder.title',
    rowLabelKey: 'help.topics.setReminder.rowLabel',
    stepKeys: [
      'help.topics.setReminder.steps.1',
      'help.topics.setReminder.steps.2',
      'help.topics.setReminder.steps.3',
      'help.topics.setReminder.steps.4',
    ],
    action: 'openReminders',
  },
  addHolding: {
    id: 'addHolding',
    titleKey: 'help.topics.addHolding.title',
    rowLabelKey: 'help.topics.addHolding.rowLabel',
    stepKeys: [
      'help.topics.addHolding.steps.1',
      'help.topics.addHolding.steps.2',
      'help.topics.addHolding.steps.3',
      'help.topics.addHolding.steps.4',
      'help.topics.addHolding.steps.5',
    ],
    action: null,
  },
  trackProperty: {
    id: 'trackProperty',
    titleKey: 'help.topics.trackProperty.title',
    rowLabelKey: 'help.topics.trackProperty.rowLabel',
    stepKeys: [
      'help.topics.trackProperty.steps.1',
      'help.topics.trackProperty.steps.2',
      'help.topics.trackProperty.steps.3',
      'help.topics.trackProperty.steps.4',
      'help.topics.trackProperty.steps.5',
    ],
    action: 'addProperty',
  },
  trackLoan: {
    id: 'trackLoan',
    titleKey: 'help.topics.trackLoan.title',
    rowLabelKey: 'help.topics.trackLoan.rowLabel',
    stepKeys: [
      'help.topics.trackLoan.steps.1',
      'help.topics.trackLoan.steps.2',
      'help.topics.trackLoan.steps.3',
      'help.topics.trackLoan.steps.4',
      'help.topics.trackLoan.steps.5',
      'help.topics.trackLoan.steps.6',
    ],
    action: 'addLoan',
  },
  addTransaction: {
    id: 'addTransaction',
    titleKey: 'help.topics.addTransaction.title',
    rowLabelKey: 'help.topics.addTransaction.rowLabel',
    stepKeys: [
      'help.topics.addTransaction.steps.1',
      'help.topics.addTransaction.steps.2',
      'help.topics.addTransaction.steps.3',
      'help.topics.addTransaction.steps.4',
    ],
    action: 'addTransaction',
  },
  editTransaction: {
    id: 'editTransaction',
    titleKey: 'help.topics.editTransaction.title',
    rowLabelKey: 'help.topics.editTransaction.rowLabel',
    stepKeys: [
      'help.topics.editTransaction.steps.1',
      'help.topics.editTransaction.steps.2',
      'help.topics.editTransaction.steps.3',
    ],
    action: null,
  },
  useTemplates: {
    id: 'useTemplates',
    titleKey: 'help.topics.useTemplates.title',
    rowLabelKey: 'help.topics.useTemplates.rowLabel',
    stepKeys: [
      'help.topics.useTemplates.steps.1',
      'help.topics.useTemplates.steps.2',
      'help.topics.useTemplates.steps.3',
      'help.topics.useTemplates.steps.4',
    ],
    action: 'openTemplates',
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
      'help.topics.manageCategories.steps.5',
    ],
    action: 'openCategories',
  },
  categoryRules: {
    id: 'categoryRules',
    titleKey: 'help.topics.categoryRules.title',
    rowLabelKey: 'help.topics.categoryRules.rowLabel',
    stepKeys: [
      'help.topics.categoryRules.steps.1',
      'help.topics.categoryRules.steps.2',
      'help.topics.categoryRules.steps.3',
      'help.topics.categoryRules.steps.4',
      'help.topics.categoryRules.steps.5',
    ],
    action: 'openCategories',
  },
  viewStatistics: {
    id: 'viewStatistics',
    titleKey: 'help.topics.viewStatistics.title',
    rowLabelKey: 'help.topics.viewStatistics.rowLabel',
    stepKeys: [
      'help.topics.viewStatistics.steps.1',
      'help.topics.viewStatistics.steps.2',
      'help.topics.viewStatistics.steps.3',
      'help.topics.viewStatistics.steps.4',
    ],
    action: 'openStatistics',
  },
  backupData: {
    id: 'backupData',
    titleKey: 'help.topics.backupData.title',
    rowLabelKey: 'help.topics.backupData.rowLabel',
    stepKeys: [
      'help.topics.backupData.steps.1',
      'help.topics.backupData.steps.2',
      'help.topics.backupData.steps.3',
      'help.topics.backupData.steps.4',
    ],
    action: 'openExportData',
  },
  restoreData: {
    id: 'restoreData',
    titleKey: 'help.topics.restoreData.title',
    rowLabelKey: 'help.topics.restoreData.rowLabel',
    stepKeys: [
      'help.topics.restoreData.steps.1',
      'help.topics.restoreData.steps.2',
      'help.topics.restoreData.steps.3',
      'help.topics.restoreData.steps.4',
    ],
    action: 'openImportData',
  },
  systemSettings: {
    id: 'systemSettings',
    titleKey: 'help.topics.systemSettings.title',
    rowLabelKey: 'help.topics.systemSettings.rowLabel',
    stepKeys: [
      'help.topics.systemSettings.steps.1',
      'help.topics.systemSettings.steps.2',
      'help.topics.systemSettings.steps.3',
      'help.topics.systemSettings.steps.4',
    ],
    action: 'openSystem',
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
    topicIds: ['addAccount', 'connectMonobank', 'connectCrypto', 'importStatement', 'setReminder'],
  },
  holdings: {
    id: 'holdings',
    titleKey: 'help.groups.holdings.title',
    topicIds: ['addHolding', 'trackProperty', 'trackLoan'],
  },
  transactions: {
    id: 'transactions',
    titleKey: 'help.groups.transactions.title',
    topicIds: ['addTransaction', 'editTransaction', 'useTemplates'],
  },
  categories: {
    id: 'categories',
    titleKey: 'help.groups.categories.title',
    topicIds: ['manageCategories', 'categoryRules'],
  },
  statistics: {
    id: 'statistics',
    titleKey: 'help.groups.statistics.title',
    topicIds: ['viewStatistics'],
  },
  settings: {
    id: 'settings',
    titleKey: 'help.groups.settings.title',
    topicIds: ['backupData', 'restoreData', 'systemSettings'],
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

import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '@kiko/test-support/navigation-props';
import { darkTheme } from '@kiko/design-system/theme';
import { type HelpTopicId, helpTopicById } from '@kiko/help';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';

import HelpTopicScreen from './help-topic.screen';

type HelpTopicProps = ComponentProps<typeof HelpTopicScreen>;

const renderScreen = (topicId: HelpTopicId, navigation: NavigationSpy = navigationSpy()) =>
  render(
    <HelpTopicScreen
      navigation={asNavigationProp<HelpTopicProps['navigation']>(navigation)}
      route={asRouteProp<HelpTopicProps['route']>('HelpTopic', { topicId })}
    />,
  );

describe('HelpTopicScreen', () => {
  it('renders the add-account steps numbered, in order', async () => {
    const { getAllByTestId } = await renderScreen('addAccount');

    const rows = getAllByTestId(/^help-topic-step-/);

    expect(rows).toHaveLength(5);

    helpTopicById('addAccount').stepKeys.forEach((key, index) => {
      expect(rows[index]).toHaveTextContent(`${index + 1}.${i18n.t(key)}`);
    });
  });

  it('renders the five manage-categories steps, naming the real Add category and Delete labels', async () => {
    const { getAllByTestId, getByTestId } = await renderScreen('manageCategories');

    expect(getAllByTestId(/^help-topic-step-/)).toHaveLength(5);
    expect(getByTestId('help-topic-step-2')).toHaveTextContent(
      `"${i18n.t('categories.addCategory')}"`,
      { exact: false },
    );
    expect(getByTestId('help-topic-step-5')).toHaveTextContent(`"${i18n.t('common.delete')}"`, {
      exact: false,
    });
  });

  it('shows only its own topic action', async () => {
    const { queryByText } = await renderScreen('manageCategories');

    expect(queryByText('Add account')).toBeNull();
  });

  it.each([
    [
      'addAccount',
      'Add account',
      ['AccountsTab', { screen: 'AccountForm', params: {}, initial: false }],
    ],
    ['addTransaction', 'Add transaction', ['TransactionForm', {}]],
    ['useTemplates', 'Open templates', ['TransactionTemplates']],
    ['setReminder', 'Open reminders', ['Reminders']],
    ['manageCategories', 'Open categories', ['Categories']],
    ['backupData', 'Open data export', ['ExportData']],
    ['restoreData', 'Open data import', ['ImportData']],
    ['systemSettings', 'Open system settings', ['System']],
  ] as const)(
    'opens the target of the %s action, labelled "%s"',
    async (topicId, label, target) => {
      const navigation = navigationSpy();
      const { getByTestId } = await renderScreen(topicId, navigation);

      expect(getByTestId('help-topic-action')).toHaveTextContent(label);

      await fireEvent.press(getByTestId('help-topic-action'));

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).toHaveBeenCalledWith(...target);
    },
  );

  it.each([
    ['addAccount', genericEntitySymbol.account],
    ['connectMonobank', genericEntitySymbol.account],
    ['connectCrypto', genericEntitySymbol.account],
    ['setReminder', entrySymbol.reminders],
    ['trackProperty', genericEntitySymbol.account],
    ['trackLoan', genericEntitySymbol.account],
    ['addTransaction', genericEntitySymbol.transaction],
    ['useTemplates', genericEntitySymbol.template],
    ['manageCategories', genericEntitySymbol.category],
    ['categoryRules', genericEntitySymbol.category],
    ['backupData', entrySymbol.exportData],
    ['restoreData', entrySymbol.importData],
    ['systemSettings', entrySymbol.system],
  ] as const)(
    'leads the footer button of the %s topic with the symbol %s',
    async (topicId, symbol) => {
      const { getByTestId } = await renderScreen(topicId);

      const glyphs = getByTestId('help-topic-action').queryAll(
        (node) => node.props.name === symbol,
      );

      expect(glyphs.length).toBeGreaterThan(0);
    },
  );

  describe.each(['importStatement', 'addHolding', 'editTransaction', 'viewStatistics'] as const)(
    'the %s topic, which has no action',
    (topicId) => {
      it('renders its steps and no footer button', async () => {
        const { getAllByTestId, queryByTestId } = await renderScreen(topicId);

        expect(getAllByTestId(/^help-topic-step-/)).toHaveLength(
          helpTopicById(topicId).stepKeys.length,
        );
        expect(helpTopicById(topicId).action).toBeNull();
        expect(queryByTestId('help-topic-action')).toBeNull();
        expect(queryByTestId('screen-footer')).toBeNull();
      });

      it('gives the screen no footer at all, so the scroll content keeps its own bottom padding', async () => {
        const { getByTestId } = await renderScreen(topicId);

        const contentStyle = StyleSheet.flatten(
          getByTestId('screen-scroll-view').props.contentContainerStyle,
        );

        // A footer owns the gap above itself, so the padding drops to 0 only when one is passed.
        expect(contentStyle.paddingBottom).toBe(darkTheme.spacing(4));
      });
    },
  );
});

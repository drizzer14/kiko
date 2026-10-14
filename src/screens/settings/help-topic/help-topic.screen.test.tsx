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
import { type HelpTopicId, helpTopicById } from '@kiko/help';

import HelpTopicScreen from './help-topic.screen';

// No registered topic has a `null` action yet, so a test sets `override` to render one that does;
// otherwise every test reads the shipped registry.
const mockTopic: { override: ReturnType<typeof helpTopicById> | undefined } = {
  override: undefined,
};
jest.mock('@kiko/help', () => {
  const actual = jest.requireActual('@kiko/help');

  return {
    ...actual,
    helpTopicById: (id: HelpTopicId) => mockTopic.override ?? actual.helpTopicById(id),
  };
});

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

  it('renders exactly the four manage-categories steps, and names the real Apply button', async () => {
    const { getAllByTestId, getByTestId } = await renderScreen('manageCategories');

    expect(getAllByTestId(/^help-topic-step-/)).toHaveLength(4);
    expect(getByTestId('help-topic-step-4')).toHaveTextContent(
      `"${i18n.t('forms.transaction.apply')}"`,
      { exact: false },
    );
  });

  it('opens the account form from the add-account action', async () => {
    const navigation = navigationSpy();
    const { getByText } = await renderScreen('addAccount', navigation);

    await fireEvent.press(getByText('Add account'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('AccountsTab', {
      screen: 'AccountForm',
      params: {},
      initial: false,
    });
  });

  it('opens Categories from the manage-categories action', async () => {
    const navigation = navigationSpy();
    const { getByText } = await renderScreen('manageCategories', navigation);

    await fireEvent.press(getByText('Open categories'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('Categories');
  });

  it('shows only its own topic action', async () => {
    const { queryByText } = await renderScreen('manageCategories');

    expect(queryByText('Add account')).toBeNull();
  });

  describe('a topic with no action', () => {
    beforeEach(() => {
      mockTopic.override = { ...helpTopicById('addAccount'), action: null };
    });

    afterEach(() => {
      mockTopic.override = undefined;
    });

    it('renders its steps and no footer', async () => {
      const { getAllByTestId, queryByTestId } = await renderScreen('addAccount');

      expect(getAllByTestId(/^help-topic-step-/)).toHaveLength(5);
      expect(queryByTestId('help-topic-action')).toBeNull();
      expect(queryByTestId('screen-footer')).toBeNull();
    });
  });
});

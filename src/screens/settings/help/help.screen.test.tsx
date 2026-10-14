import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '@kiko/test-support/navigation-props';
import { darkTheme } from '@kiko/design-system/theme';
import { HELP_GROUPS, HELP_TOPICS } from '@kiko/help';
import { chevronSize, chevronTrailingWhitespace } from '@kiko/screens/settings/settings-row';

import HelpScreen from './help.screen';

type HelpProps = ComponentProps<typeof HelpScreen>;

type JsonNode = {
  props: { testID?: string };
  children: readonly (JsonNode | string)[] | null;
};

const renderScreen = (navigation: NavigationSpy = navigationSpy()) =>
  render(
    <HelpScreen
      navigation={asNavigationProp<HelpProps['navigation']>(navigation)}
      route={asRouteProp<HelpProps['route']>('Help')}
    />,
  );

const findByTestId = (node: JsonNode, testID: string): JsonNode | undefined =>
  node.props.testID === testID
    ? node
    : (node.children ?? [])
        .flatMap((child) => (typeof child === 'string' ? [] : [findByTestId(child, testID)]))
        .find((found) => found !== undefined);

describe('HelpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders one section per group, in order', async () => {
    const { getAllByTestId } = await renderScreen();

    expect(getAllByTestId(/^help-group-/).map((node) => node.props.testID)).toEqual(
      HELP_GROUPS.map((group) => `help-group-${group.id}`),
    );
  });

  it.each(HELP_GROUPS)('shows the $id group title, then its card', async (group) => {
    const { toJSON } = await renderScreen();

    const section = findByTestId(toJSON() as JsonNode, `help-group-${group.id}`);
    const [heading, card, ...rest] = section?.children ?? [];

    expect(rest).toEqual([]);
    expect((heading as JsonNode).children).toEqual([i18n.t(group.titleKey)]);
    expect((card as JsonNode).props.testID).toBe(`help-card-${group.id}`);
  });

  it.each(HELP_GROUPS)('puts the rows of the $id group in its own card', async (group) => {
    const { getByTestId } = await renderScreen();

    const card = within(getByTestId(`help-card-${group.id}`));

    expect(card.getAllByTestId(/^help-row-/).map((node) => node.props.testID)).toEqual(
      group.topics.map((topic) => `help-row-${topic.id}`),
    );

    for (const topic of group.topics) {
      expect(card.getByText(i18n.t(topic.rowLabelKey))).toBeTruthy();
    }

    expect(card.queryAllByTestId(`help-divider-${group.id}`)).toHaveLength(group.topics.length - 1);
  });

  it('puts the divider after the first row of a group, never before it', async () => {
    const { getAllByTestId } = await renderScreen();

    const orderedIds = getAllByTestId(/^help-(divider-|row-)/).map(
      (node) => node.props.testID as string,
    );

    expect(orderedIds).toEqual(
      HELP_GROUPS.flatMap((group) =>
        group.topics.flatMap((topic, index) => [
          ...(index > 0 ? [`help-divider-${group.id}`] : []),
          `help-row-${topic.id}`,
        ]),
      ),
    );
  });

  it('pads each row to match the Settings card', async () => {
    const { getByTestId } = await renderScreen();
    const theme = darkTheme;

    for (const topic of HELP_TOPICS) {
      const rowStyle = StyleSheet.flatten(getByTestId(`help-row-${topic.id}`).props.style);

      expect(rowStyle.paddingHorizontal).toBe(theme.spacing(3));
      expect(rowStyle.paddingVertical).toBe(theme.spacing(3));
    }
  });

  it('puts one divider between each pair of rows of the accounts group, never before the first', async () => {
    const { getByTestId } = await renderScreen();

    const card = within(getByTestId('help-card-accounts'));

    expect(
      card.getAllByTestId(/^help-(divider-|row-)/).map((node) => node.props.testID as string),
    ).toEqual([
      'help-row-addAccount',
      'help-divider-accounts',
      'help-row-connectMonobank',
      'help-divider-accounts',
      'help-row-connectCrypto',
      'help-divider-accounts',
      'help-row-importStatement',
      'help-divider-accounts',
      'help-row-setReminder',
    ]);
  });

  it('draws no divider in the statistics group, which holds one topic', async () => {
    const { getByTestId } = await renderScreen();

    expect(within(getByTestId('help-card-statistics')).queryAllByTestId(/^help-divider-/)).toEqual(
      [],
    );
  });

  it('insets each divider to match the Settings card', async () => {
    const { getAllByTestId } = await renderScreen();
    const theme = darkTheme;

    const dividers = getAllByTestId(/^help-divider-/);

    expect(dividers.length).toBeGreaterThan(0);

    for (const divider of dividers) {
      const dividerStyle = StyleSheet.flatten(divider.props.style);

      expect(dividerStyle.marginLeft).toBe(theme.spacing(3));
      expect(dividerStyle.marginRight).toBe(
        theme.spacing(3) + chevronTrailingWhitespace(chevronSize(theme), theme),
      );
    }

    expect(chevronTrailingWhitespace(chevronSize(theme), theme)).toBeGreaterThan(0);
  });

  it('centers the privacy line', async () => {
    const { getByText } = await renderScreen();

    expect(
      StyleSheet.flatten(getByText('All your data stays on this device.').props.style),
    ).toEqual(expect.objectContaining({ textAlign: 'center' }));
  });

  it('opens a topic page with its id when a row is pressed', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    await fireEvent.press(getByTestId('help-row-manageCategories'));

    expect(navigation.navigate).toHaveBeenCalledWith('HelpTopic', {
      topicId: 'manageCategories',
    });
  });

  it('shows the privacy line', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('All your data stays on this device.')).toBeTruthy();
  });
});

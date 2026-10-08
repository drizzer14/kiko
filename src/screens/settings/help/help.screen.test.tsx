import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { HELP_TOPICS } from '@kiko/help';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '@kiko/test-support/navigation-props';
import { darkTheme } from '@kiko/design-system/theme';
import { chevronSize, chevronTrailingWhitespace } from '@kiko/screens/settings/settings-row';

import HelpScreen from './help.screen';

type HelpProps = ComponentProps<typeof HelpScreen>;

const mockResetTips = jest.fn((): Promise<void> => Promise.resolve());

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    resetTips: () => mockResetTips(),
  },
}));

const renderScreen = (navigation: NavigationSpy = navigationSpy()) =>
  render(
    <HelpScreen
      navigation={asNavigationProp<HelpProps['navigation']>(navigation)}
      route={asRouteProp<HelpProps['route']>('Help')}
    />,
  );

describe('HelpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders one row per topic in a single card group with a divider between rows', async () => {
    const { getByTestId, getAllByTestId } = await renderScreen();

    const card = getByTestId('help-card-topics');

    for (const topic of HELP_TOPICS) {
      expect(within(card).getByTestId(`help-row-${topic.id}`)).toBeTruthy();
      expect(within(card).getByText(i18n.t(topic.rowLabelKey))).toBeTruthy();
    }

    expect(getAllByTestId('help-divider-topics')).toHaveLength(HELP_TOPICS.length - 1);
  });

  it('puts the divider after the first row, never before it', async () => {
    const { getAllByTestId } = await renderScreen();

    const orderedIds = getAllByTestId(/^help-(divider-topics|row-)/).map(
      (node) => node.props.testID as string,
    );

    expect(orderedIds).toEqual([
      `help-row-${HELP_TOPICS[0].id}`,
      'help-divider-topics',
      `help-row-${HELP_TOPICS[1].id}`,
    ]);
  });

  it('pads each row and insets the divider to match the Settings card', async () => {
    const { getByTestId, getAllByTestId } = await renderScreen();
    const theme = darkTheme;

    for (const topic of HELP_TOPICS) {
      const rowStyle = StyleSheet.flatten(getByTestId(`help-row-${topic.id}`).props.style);

      expect(rowStyle.paddingHorizontal).toBe(theme.spacing(3));
      expect(rowStyle.paddingVertical).toBe(theme.spacing(3));
    }

    const dividerStyle = StyleSheet.flatten(getAllByTestId('help-divider-topics')[0].props.style);

    expect(dividerStyle.marginLeft).toBe(theme.spacing(3));
    expect(dividerStyle.marginRight).toBe(
      theme.spacing(3) + chevronTrailingWhitespace(chevronSize(theme), theme),
    );
    expect(chevronTrailingWhitespace(chevronSize(theme), theme)).toBeGreaterThan(0);
  });

  it('centers the privacy line', async () => {
    const { getByText } = await renderScreen();

    expect(
      StyleSheet.flatten(getByText('All your data stays on this device.').props.style),
    ).toEqual(expect.objectContaining({ textAlign: 'center' }));
  });

  it('logs a failed tips reset under the help tag', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockResetTips.mockRejectedValueOnce(new Error('boom'));
    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Show tips again'));

    expect(warn).toHaveBeenCalledWith('[help] tips reset failed', expect.anything());
    warn.mockRestore();
  });

  it('opens a topic page with its id when a row is pressed', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    await fireEvent.press(getByTestId('help-row-manageCategories'));

    expect(navigation.navigate).toHaveBeenCalledWith('HelpTopic', {
      topicId: 'manageCategories',
    });
  });

  it('clears the dismissed tips once when "Show tips again" is pressed', async () => {
    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Show tips again'));

    expect(mockResetTips).toHaveBeenCalledTimes(1);
  });

  it('does not clear the tips until the button is pressed', async () => {
    await renderScreen();

    expect(mockResetTips).not.toHaveBeenCalled();
  });

  it('shows the privacy line', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('All your data stays on this device.')).toBeTruthy();
  });
});

import type { ComponentProps } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
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

  describe('tips reset confirmation', () => {
    it('shows no confirmation tip before the button is pressed', async () => {
      const { queryByTestId, queryByText } = await renderScreen();

      expect(queryByTestId('help-tips-reset-tip')).toBeNull();
      expect(queryByText('Tips will be shown again.')).toBeNull();
    });

    it('shows the confirmation tip above the button after a successful reset', async () => {
      const { getByText, findByText, getAllByTestId } = await renderScreen();

      await fireEvent.press(getByText('Show tips again'));

      expect(await findByText('Tips will be shown again.')).toBeTruthy();
      expect(
        getAllByTestId(/^help-(tips-reset-tip|show-tips-again)$/).map(
          (node) => node.props.testID as string,
        ),
      ).toEqual(['help-tips-reset-tip', 'help-show-tips-again']);
    });

    it('announces the confirmation to VoiceOver when it appears', async () => {
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation(() => undefined);
      const { getByText, findByText } = await renderScreen();

      await fireEvent.press(getByText('Show tips again'));
      await findByText('Tips will be shown again.');

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Tips will be shown again.');
      announce.mockRestore();
    });

    it('shows no confirmation tip and no announcement when the reset fails', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation(() => undefined);
      mockResetTips.mockRejectedValueOnce(new Error('boom'));
      const { getByText, queryByTestId } = await renderScreen();

      await fireEvent.press(getByText('Show tips again'));

      expect(warn).toHaveBeenCalledWith('[help] tips reset failed', expect.anything());
      expect(queryByTestId('help-tips-reset-tip')).toBeNull();
      expect(announce).not.toHaveBeenCalled();
      warn.mockRestore();
      announce.mockRestore();
    });

    it('hides the confirmation tip when its close button is pressed', async () => {
      const { getByText, findByTestId, getByRole, queryByTestId } = await renderScreen();

      await fireEvent.press(getByText('Show tips again'));
      await findByTestId('help-tips-reset-tip');
      await fireEvent.press(getByRole('button', { name: 'Close tip' }));

      expect(queryByTestId('help-tips-reset-tip')).toBeNull();
    });

    it('keeps a single confirmation tip when the button is pressed again', async () => {
      const { getByText, findByTestId, getAllByTestId } = await renderScreen();

      await fireEvent.press(getByText('Show tips again'));
      await findByTestId('help-tips-reset-tip');
      await fireEvent.press(getByText('Show tips again'));

      expect(mockResetTips).toHaveBeenCalledTimes(2);
      expect(getAllByTestId('help-tips-reset-tip')).toHaveLength(1);
    });

    describe('with fake timers', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('keeps the confirmation tip shown after a long wait, with no auto-hide', async () => {
        const { getByText, findByTestId, getByTestId } = await renderScreen();

        await fireEvent.press(getByText('Show tips again'));
        await findByTestId('help-tips-reset-tip');
        await act(async () => {
          jest.advanceTimersByTime(10 * 60 * 1000);
        });

        expect(getByTestId('help-tips-reset-tip')).toBeTruthy();
      });
    });

    describe('under the uk language', () => {
      afterEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      });

      it('reads the confirmation in Ukrainian', async () => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
        const { getByTestId, findByTestId } = await renderScreen();

        await fireEvent.press(getByTestId('help-show-tips-again'));
        await findByTestId('help-tips-reset-tip');

        expect(getByTestId('help-tips-reset-tip')).toHaveTextContent(
          i18n.t('help.tipsResetConfirmation'),
        );
        expect(i18n.t('help.tipsResetConfirmation')).not.toBe('Tips will be shown again.');
      });
    });
  });
});

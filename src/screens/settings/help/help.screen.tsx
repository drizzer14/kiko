import { HELP_TOPICS } from '@kiko/help';
import SettingsRow, {
  chevronSize,
  chevronTrailingWhitespace,
} from '@kiko/screens/settings/settings-row';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo } from 'react-native';
import { logOnFailure } from '@kiko/diagnostics';
import { type FC, Fragment, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import Card from '@kiko/design-system/components/card';
import Screen from '@kiko/design-system/components/screen';
import Button from '@kiko/design-system/components/button';
import Divider from '@kiko/design-system/components/divider';
import TipCard from '@kiko/design-system/components/tip-card';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type HelpScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Help'>;

const styles = StyleSheet.create(() => ({
  privacy: {
    textAlign: 'center',
  },
}));

const HelpScreen: FC<HelpScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [resetConfirmed, setResetConfirmed] = useState(false);

  // The same row padding and trailing divider inset as the Settings data-transfer card (see
  // `settings.screen.tsx`). These rows have no leading icon, so the divider starts at the row's
  // own padding, which is where the label starts.
  const rowStyle = {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
  };
  const dividerStyle = {
    marginLeft: theme.spacing(3),
    marginRight: theme.spacing(3) + chevronTrailingWhitespace(chevronSize(theme), theme),
  };

  const handleShowTipsAgain = async (): Promise<void> => {
    const reset = await logOnFailure('[help] tips reset failed', () => settingsRepo.resetTips());

    if (reset) {
      setResetConfirmed(true);
      // A tip appearing above the pressed button is silent to VoiceOver without this.
      AccessibilityInfo.announceForAccessibility(t('help.tipsResetConfirmation'));
    }
  };

  return (
    <Screen scroll>
      <Box gap={4}>
        <Card testID="help-card-topics" padding={0}>
          {HELP_TOPICS.map((topic, index) => (
            <Fragment key={topic.id}>
              {index > 0 && <Divider testID="help-divider-topics" style={dividerStyle} />}

              <SettingsRow
                testID={`help-row-${topic.id}`}
                label={t(topic.rowLabelKey)}
                onPress={() => navigation.navigate('HelpTopic', { topicId: topic.id })}
                style={rowStyle}
              />
            </Fragment>
          ))}
        </Card>

        {resetConfirmed && (
          <TipCard
            testID="help-tips-reset-tip"
            message={t('help.tipsResetConfirmation')}
            closeLabel={t('tips.close')}
            onClose={() => setResetConfirmed(false)}
          />
        )}

        <Button
          testID="help-show-tips-again"
          variant="secondaryTonal"
          onPress={handleShowTipsAgain}
        >
          {t('help.showTipsAgain')}
        </Button>

        <Text variant="caption" tone="textSecondary" style={styles.privacy}>
          {t('help.privacy')}
        </Text>
      </Box>
    </Screen>
  );
};

export default HelpScreen;

import type { FC } from 'react';
import { match } from 'ts-pattern';
import { helpTopicById } from '@kiko/help';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native-unistyles';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import Screen from '@kiko/design-system/components/screen';
import Button from '@kiko/design-system/components/button';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { openAccountForm } from '@kiko/navigation/open-account-form';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { SettingsStackParamList, TabParamList } from '@kiko/navigation/types';

// The Add account action leaves the Settings tab for the Accounts tab's form, so the screen holds
// the tab navigator's props too, as Home does.
type HelpTopicScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SettingsStackParamList, 'HelpTopic'>,
  NativeBottomTabScreenProps<TabParamList, 'SettingsTab'>
>;

const styles = StyleSheet.create(() => ({
  // Lets a long step wrap beside its number instead of running past the screen edge.
  stepText: {
    flex: 1,
  },
}));

const HelpTopicScreen: FC<HelpTopicScreenProps> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const topic = helpTopicById(route.params.topicId);

  // `undefined` for a topic with no action, so `Screen` draws no footer at all.
  const footer = foldMap(maybe(topic.action), (helpAction) => {
    const action = match(helpAction)
      .with('addAccount', () => ({
        label: t('accounts.addAccount'),
        icon: genericEntitySymbol.account,
        onPress: () => openAccountForm(navigation),
      }))
      .with('addTransaction', () => ({
        label: t('home.addTransaction'),
        icon: genericEntitySymbol.transaction,
        onPress: () => navigation.navigate('TransactionForm', {}),
      }))
      .with('openCategories', () => ({
        label: t('help.actions.openCategories'),
        icon: genericEntitySymbol.category,
        onPress: () => navigation.navigate('Categories'),
      }))
      .with('openTemplates', () => ({
        label: t('help.actions.openTemplates'),
        icon: genericEntitySymbol.template,
        onPress: () => navigation.navigate('TransactionTemplates'),
      }))
      .with('openReminders', () => ({
        label: t('help.actions.openReminders'),
        icon: entrySymbol.reminders,
        onPress: () => navigation.navigate('Reminders'),
      }))
      .with('openExportData', () => ({
        label: t('help.actions.openExportData'),
        icon: entrySymbol.exportData,
        onPress: () => navigation.navigate('ExportData'),
      }))
      .with('openImportData', () => ({
        label: t('help.actions.openImportData'),
        icon: entrySymbol.importData,
        onPress: () => navigation.navigate('ImportData'),
      }))
      .with('openSystem', () => ({
        label: t('help.actions.openSystem'),
        icon: entrySymbol.system,
        onPress: () => navigation.navigate('System'),
      }))
      .exhaustive();

    return (
      <Button testID="help-topic-action" icon={action.icon} onPress={action.onPress}>
        {action.label}
      </Button>
    );
  });

  return (
    <Screen scroll footer={footer}>
      <Box gap={3}>
        {topic.stepKeys.map((stepKey, index) => (
          <Box key={stepKey} testID={`help-topic-step-${index + 1}`} direction="row" gap={3}>
            <Text tone="textSecondary">{`${index + 1}.`}</Text>

            <Box style={styles.stepText}>
              <Text>{t(stepKey)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Screen>
  );
};

export default HelpTopicScreen;

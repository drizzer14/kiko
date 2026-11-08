import {
  buildCsvText,
  csvDialectOf,
  deleteCsvExportsIfIdle,
  readDataSnapshot,
  shareCsvExport,
  writeCsvExport,
} from '@kiko/data-transfer';
import { match } from 'ts-pattern';
import { confirmOwner } from '@kiko/auth';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useRef } from 'react';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { Alert, Share, type ViewInstance } from 'react-native';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { shareAnchorOf, toFileShareUrl } from '@kiko/screens/settings/export-data';

type ExportCsvScreenProps = NativeStackScreenProps<SettingsStackParamList, 'ExportCsv'>;

const ExportCsvScreen: FC<ExportCsvScreenProps> = () => {
  const { t, i18n } = useTranslation();
  const shareButtonRef = useRef<ViewInstance>(null);

  useEffect(() => {
    // deleteCsvExportsIfIdle folds every failure and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    deleteCsvExportsIfIdle();
  }, []);

  const runExport = async (): Promise<void> => {
    const owner = await confirmOwner(t('auth.reason.exportCsv'));

    const confirmed = match(owner)
      .with({ kind: 'confirmed' }, () => true)
      // A device with no passcode shows the same data to anyone who holds it, so the warning
      // above is the whole gate there; the backup export refuses only because of its secrets.
      .with({ kind: 'noPasscode' }, () => true)
      .with({ kind: 'cancelled' }, () => false)
      .with({ kind: 'failed' }, (result) => {
        Alert.alert(t('auth.reauth.failedTitle'), t(result.hintKey));

        return false;
      })
      .exhaustive();

    if (!confirmed) {
      return;
    }

    try {
      const snapshot = await readDataSnapshot();
      const path = await writeCsvExport(
        buildCsvText({ snapshot, dialect: csvDialectOf(i18n.language), t }),
      );

      await shareCsvExport(path, () =>
        Share.share(
          { url: toFileShareUrl(path) },
          { anchor: shareAnchorOf(shareButtonRef.current) },
        ),
      );
    } catch {
      alertOnCatch(t, 'settings.csvExport.errorTitle', 'settings.csvExport.errorMessage');
    }
  };

  const { onPress: handleShare, isSubmitting } = useSubmitOnce(runExport);

  return (
    <Screen
      scroll
      floatingFooter
      footer={
        <Box direction="row" gap={2}>
          <Button
            ref={shareButtonRef}
            testID="settings-button-export-csv"
            variant="primary"
            onPress={handleShare}
            disabled={isSubmitting}
          >
            {t('settings.csvExport.shareButton')}
          </Button>
        </Box>
      }
    >
      <Box gap={4}>
        <Card testID="settings-card-export-csv-warning" padding={3}>
          <Text variant="body" tone="textPrimary">
            {t('settings.csvExport.warning')}
          </Text>
        </Card>

        <Text variant="body" tone="textSecondary">
          {t('settings.csvExport.contents')}
        </Text>

        <Text variant="body" tone="textSecondary">
          {t('settings.csvExport.notBackup')}
        </Text>
      </Box>
    </Screen>
  );
};

export default ExportCsvScreen;

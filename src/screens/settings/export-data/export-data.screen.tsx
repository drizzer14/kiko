import { exportData } from '@kiko/data-transfer/export-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Clipboard from '@react-native-clipboard/clipboard';
import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import Share from 'react-native/Libraries/Share/Share';

// Side-effect import: initializes i18next (see src/i18n/index.ts). In the app
// this happens once, ahead of any render, via App.tsx's own import; this
// screen's test renders it standalone with no such import of its own (unlike
// its sibling settings screens' tests), so without this the real
// `useTranslation()` below would read every `t(...)` key with no resources
// loaded and return the raw key instead of English text.
import '../../../i18n';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import Card from '../../../design-system/components/card';
import Screen from '../../../design-system/components/screen';
import Switch from '../../../design-system/components/switch';
import Text from '../../../design-system/components/text';
import TextField from '../../../design-system/components/text-field';
import type { SettingsStackParamList } from '../../../navigation/types';
import SettingsRow from '../settings-row';
import { useSubmitOnce } from '../../forms/use-submit-once/use-submit-once';

type ExportDataScreenProps = NativeStackScreenProps<SettingsStackParamList, 'ExportData'>;

const ExportDataScreen: FC<ExportDataScreenProps> = () => {
  const { t } = useTranslation();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [keyBase64, setKeyBase64] = useState<string | undefined>(undefined);
  const [fileUri, setFileUri] = useState<string | undefined>(undefined);

  const runExport = async (): Promise<void> => {
    try {
      const result = await exportData({ includeSecrets });
      setKeyBase64(result.keyBase64);
      setFileUri(result.fileUri);
    } catch {
      Alert.alert(t('settings.dataExport.errorTitle'), t('settings.dataExport.errorMessage'));
    }
  };

  const { onPress: handleExport, isSubmitting } = useSubmitOnce(runExport);

  const handleCopyKey = (): void => {
    if (keyBase64 !== undefined) {
      Clipboard.setString(keyBase64);
    }
  };

  const handleShareFile = (): void => {
    if (fileUri !== undefined) {
      Share.share({ url: fileUri });
    }
  };

  return (
    <Screen scroll>
      <Box gap={4}>
        <Card testID="settings-card-export-secrets" padding={3}>
          <SettingsRow icon="key" label={t('settings.dataExport.includeSecrets')}>
            <Switch
              testID="settings-switch-export-secrets"
              value={includeSecrets}
              onValueChange={setIncludeSecrets}
            />
            <Text variant="caption" tone="textSecondary">
              {t('settings.dataExport.includeSecretsHint')}
            </Text>
          </SettingsRow>
        </Card>

        <Text variant="body" tone="textSecondary">
          {t('settings.dataExport.description')}
        </Text>

        <Button testID="settings-button-export" onPress={handleExport} disabled={isSubmitting}>
          {t('settings.dataExport.exportButton')}
        </Button>

        {keyBase64 !== undefined && (
          <Card testID="settings-card-export-key" padding={3}>
            <Text variant="body">{t('settings.dataExport.keyWarning')}</Text>
            <TextField
              label={t('settings.dataExport.keyLabel')}
              value={keyBase64}
              onChangeText={() => {}}
              editable={false}
              multiline
            />
            <Box direction="row" gap={3}>
              <Button
                testID="settings-button-copy-key"
                variant="secondaryTonal"
                onPress={handleCopyKey}
              >
                {t('settings.dataExport.copyKey')}
              </Button>
              <Button
                testID="settings-button-share-file"
                variant="secondaryTonal"
                onPress={handleShareFile}
              >
                {t('settings.dataExport.shareFile')}
              </Button>
            </Box>
          </Card>
        )}
      </Box>
    </Screen>
  );
};

export default ExportDataScreen;

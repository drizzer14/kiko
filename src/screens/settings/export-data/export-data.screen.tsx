import type { FC } from 'react';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { exportData } from '@kiko/data-transfer/export-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import SettingsRow from '../settings-row';
import Box from '../../../design-system/components/box';
import Card from '../../../design-system/components/card';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import Switch from '../../../design-system/components/switch';
import TextField from '../../../design-system/components/text-field';
import type { SettingsStackParamList } from '../../../navigation/types';
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

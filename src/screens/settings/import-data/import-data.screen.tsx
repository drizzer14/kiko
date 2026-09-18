import type { FC } from 'react';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { importData } from '@kiko/data-transfer/import-data';
import { pick, types } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import Box from '../../../design-system/components/box';
import Card from '../../../design-system/components/card';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import type { SettingsStackParamList } from '../../../navigation/types';
import ClipboardTextField from '../../account-detail/clipboard-text-field';
import ConfirmSheet from '../../../design-system/components/confirm-sheet';
import { useSubmitOnce } from '../../forms/use-submit-once/use-submit-once';

type ImportDataScreenProps = NativeStackScreenProps<SettingsStackParamList, 'ImportData'>;

const ImportDataScreen: FC<ImportDataScreenProps> = () => {
  const { t } = useTranslation();
  const [fileUri, setFileUri] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [keyBase64, setKeyBase64] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | undefined>(undefined);

  const handlePickFile = async (): Promise<void> => {
    try {
      const results = await pick({ type: [types.allFiles] });
      const picked = results.at(0);

      if (picked) {
        setFileUri(picked.uri);
        setFileName(picked.name ?? picked.uri);
      }
    } catch {
      // A cancelled picker rejects — the expected "user backed out" case
      // (same convention as the statement-import picker): fail silently.
    }
  };

  const runImport = async (): Promise<void> => {
    if (fileUri === undefined) {
      return;
    }

    try {
      const summary = await importData({ fileUri, keyBase64 });
      setResultMessage(
        t('settings.dataImport.successMessage', { count: summary.accountsRestored }),
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.startsWith('data-transfer/decrypt')
          ? t('settings.dataImport.wrongKeyError')
          : t('settings.dataImport.invalidFileError');
      Alert.alert(t('settings.dataImport.errorTitle'), message);
    }
  };

  const { onPress: handleConfirmedImport, isSubmitting } = useSubmitOnce(runImport);

  const handleConfirm = (): void => {
    setConfirmVisible(false);
    handleConfirmedImport();
  };

  return (
    <Screen scroll>
      <Box gap={4}>
        <Text variant="body" tone="textSecondary">
          {t('settings.dataImport.description')}
        </Text>

        <Card testID="settings-card-import-file" padding={3}>
          <Button
            testID="settings-button-pick-file"
            variant="secondaryTonal"
            onPress={handlePickFile}
          >
            {fileName ?? t('settings.dataImport.chooseFile')}
          </Button>
        </Card>

        <Card testID="settings-card-import-key" padding={3}>
          <ClipboardTextField
            label={t('settings.dataImport.keyLabel')}
            value={keyBase64}
            onChangeText={setKeyBase64}
            placeholder={t('settings.dataImport.keyPlaceholder')}
            pasteAccessibilityLabel={t('settings.dataImport.pasteKey')}
            secureTextEntry
          />
        </Card>

        <Button
          testID="settings-button-import"
          onPress={() => setConfirmVisible(true)}
          disabled={isSubmitting || fileUri === undefined || keyBase64.length === 0}
        >
          {t('settings.dataImport.importButton')}
        </Button>

        {resultMessage !== undefined && (
          // `Text` does not forward `testID` (design-system/components/text);
          // no test queries this row, so the prop is simply dropped rather
          // than adding testID support to the shared component.
          <Text variant="body">{resultMessage}</Text>
        )}
      </Box>

      <ConfirmSheet
        visible={confirmVisible}
        title={t('settings.dataImport.confirmTitle')}
        message={t('settings.dataImport.confirmMessage')}
        confirmLabel={t('settings.dataImport.confirmButton')}
        destructive
        onConfirm={handleConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </Screen>
  );
};

export default ImportDataScreen;

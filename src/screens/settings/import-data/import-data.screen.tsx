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

// A Kiko export file's name always ends `.kiko` (see
// `src/data-transfer/export-data.ts`, which writes `kiko-export-<ts>.kiko`).
// The document picker's `type` filter only understands standard UTIs/MIMEs —
// there is no custom `.kiko` UTI to declare without an Info.plist
// `UTExportedTypeDeclaration` (out of scope) — so this extension check on the
// picked file's NAME is the real guard, not the `type` hint passed to `pick`.
const KIKO_FILE_EXTENSION = '.kiko';

// The export key is a base64-encoded 32-byte key: 44 characters. Anything
// shorter is unambiguously not a full key (a truncated paste, a stray
// keystroke), so it is rejected before the confirm sheet ever opens rather
// than surfacing as a confusing "wrong key" error after a real import attempt.
const MIN_KEY_LENGTH = 44;

const ImportDataScreen: FC<ImportDataScreenProps> = () => {
  const { t } = useTranslation();
  const [fileUri, setFileUri] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [keyBase64, setKeyBase64] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | undefined>(undefined);
  const [wrongFileTypeError, setWrongFileTypeError] = useState(false);
  const [keyTooShortError, setKeyTooShortError] = useState(false);
  const [noFileError, setNoFileError] = useState(false);

  const handlePickFile = async (): Promise<void> => {
    try {
      const results = await pick({ type: [types.json, types.allFiles] });
      const picked = results.at(0);

      if (!picked) {
        return;
      }

      const name = picked.name ?? picked.uri;

      if (!name.toLowerCase().endsWith(KIKO_FILE_EXTENSION)) {
        setFileUri(undefined);
        setFileName(undefined);
        setWrongFileTypeError(true);
        return;
      }

      setWrongFileTypeError(false);
      setNoFileError(false);
      setFileUri(picked.uri);
      setFileName(name);
    } catch {
      // A cancelled picker rejects — the expected "user backed out" case
      // (same convention as the statement-import picker): fail silently.
    }
  };

  const handleKeyChange = (text: string): void => {
    setKeyBase64(text);
    setKeyTooShortError(false);
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

  const handleImportPress = (): void => {
    // BUG (device-feedback-round-4 item 7): pressing Import with no file
    // and/or no key used to fail SILENTLY — an early `return` on a missing
    // file skipped the key check entirely, so a combined "nothing picked,
    // nothing pasted" press showed no error at all. Both are now validated
    // independently on every press, each surfacing its own inline error.
    const missingFile = fileUri === undefined;
    const missingKey = keyBase64.length < MIN_KEY_LENGTH;

    setNoFileError(missingFile);
    setKeyTooShortError(missingKey);

    if (missingFile || missingKey) {
      return;
    }

    setConfirmVisible(true);
  };

  const handleConfirm = (): void => {
    setConfirmVisible(false);
    handleConfirmedImport();
  };

  return (
    <Screen
      scroll
      footer={
        <Box direction="row" gap={2}>
          <Button
            testID="settings-button-import"
            variant="primary"
            fullWidth
            onPress={handleImportPress}
            disabled={isSubmitting}
          >
            {t('settings.dataImport.importButton')}
          </Button>
        </Box>
      }
    >
      <Box gap={4}>
        <Text variant="body" tone="textSecondary">
          {t('settings.dataImport.description')}
        </Text>

        <Card testID="settings-card-import-file" padding={3}>
          <Box gap={2}>
            <Button
              testID="settings-button-pick-file"
              variant="secondaryTonal"
              onPress={handlePickFile}
            >
              {fileName ?? t('settings.dataImport.chooseFile')}
            </Button>

            {wrongFileTypeError && (
              <Text variant="caption" tone="negative">
                {t('settings.dataImport.wrongFileTypeError')}
              </Text>
            )}

            {/* The more specific wrong-file-type error above already implies
                "no valid file chosen yet" — showing both would be redundant,
                so this only renders when that one is not already up. */}
            {noFileError && !wrongFileTypeError && (
              <Text variant="caption" tone="negative">
                {t('settings.dataImport.noFileError')}
              </Text>
            )}
          </Box>
        </Card>

        <Card testID="settings-card-import-key" padding={3}>
          <Box gap={2}>
            <ClipboardTextField
              label={t('settings.dataImport.keyLabel')}
              value={keyBase64}
              onChangeText={handleKeyChange}
              placeholder={t('settings.dataImport.keyPlaceholder')}
              pasteAccessibilityLabel={t('settings.dataImport.pasteKey')}
              secureTextEntry
            />

            {keyTooShortError && (
              <Text variant="caption" tone="negative">
                {t('settings.dataImport.keyTooShortError')}
              </Text>
            )}
          </Box>
        </Card>

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

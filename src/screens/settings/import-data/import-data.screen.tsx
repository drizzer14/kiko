import { Alert } from 'react-native';
import { i18n } from '@kiko/i18n/init';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importData } from '@kiko/data-transfer';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import FieldError from '@kiko/design-system/components/field-error';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';
import { keepLocalCopy, pick, types } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { replanRestoredReminders } from '@kiko/reminders/use-reminder-scheduler';
import ClipboardTextField from '@kiko/design-system/components/clipboard-text-field';

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

// The picker returns a display name, but on some sources it hands back only a
// URI (or a full path). Reduce either to just the file's own name — the last
// path segment, percent-decoded, minus any query/fragment — so the button
// shows `kiko-demo.kiko`, not a `file://…/Documents/kiko-demo.kiko` path.
const fileNameFrom = (value: string): string => {
  const path = value.split(/[?#]/)[0] ?? value;
  const segment = path.slice(path.lastIndexOf('/') + 1) || path;

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

// The error copy for a failed import, picked by the prefix `importData`'s own
// decrypt step puts on the message; anything else reads as an invalid file.
const IMPORT_ERROR_KEYS = [['data-transfer/decrypt', 'settings.dataImport.wrongKeyError']] as const;

const importErrorKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';

  return (
    IMPORT_ERROR_KEYS.find(([prefix]) => message.startsWith(prefix))?.[1] ??
    'settings.dataImport.invalidFileError'
  );
};

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

      const name = fileNameFrom(picked.name ?? picked.uri);

      if (!name.toLowerCase().endsWith(KIKO_FILE_EXTENSION)) {
        setFileUri(undefined);
        setFileName(undefined);
        setWrongFileTypeError(true);

        return;
      }

      // The picker hands back a security-scoped external URI (iCloud / Files /
      // an AirDropped file) that `RNFS.readFile` cannot read directly — the
      // read yields nothing and import fails as "invalid file". Copy the
      // file into the app's cache first and read that local copy; fall
      // back to the original uri only if the copy fails.
      const [copied] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: name }],
        destination: 'cachesDirectory',
      });

      setWrongFileTypeError(false);
      setNoFileError(false);
      setFileUri(copied.status === 'success' ? copied.localUri : picked.uri);
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

      // Before the language change below, which re-plans too: that re-plan
      // must already see the restarted counts. Never rejects.
      await replanRestoredReminders();

      // The imported settings row can carry a different language than the
      // one currently active. Apply it BEFORE resolving the success
      // message's copy so that message renders in the restored language,
      // not the pre-import one — `useSyncLanguageWithSettings` would
      // otherwise apply it only later, asynchronously, off a live query.
      // See import-data.ts's `languageRestored` doc comment. The hook's own
      // `t` is a FIXED-language function snapshotted at this render (see
      // react-i18next's `getFixedT`), so it would still resolve to the
      // PRE-import language even after `changeLanguage` resolves — the raw
      // `i18n.t` reads the current language dynamically instead.
      if (summary.languageRestored != null && summary.languageRestored !== i18n.language) {
        await i18n.changeLanguage(summary.languageRestored);
      }

      setResultMessage(
        i18n.t('settings.dataImport.successMessage', { count: summary.accountsRestored }),
      );
    } catch (error) {
      Alert.alert(t('settings.dataImport.errorTitle'), t(importErrorKey(error)));
    }
  };

  const { onPress: handleConfirmedImport, isSubmitting } = useSubmitOnce(runImport);

  const handleImportPress = (): void => {
    // Pressing Import with no file and/or no key used to fail SILENTLY — an
    // early `return` on a missing file skipped the key check entirely, so a
    // combined "nothing picked, nothing pasted" press showed no error at
    // all. Both are now validated independently on every press, each
    // surfacing its own inline error.
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
              <FieldError message={t('settings.dataImport.wrongFileTypeError')} />
            )}

            {/* The more specific wrong-file-type error above already implies
                "no valid file chosen yet" — showing both would be redundant,
                so this only renders when that one is not already up. */}
            {noFileError && !wrongFileTypeError && (
              <FieldError message={t('settings.dataImport.noFileError')} />
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
              error={keyTooShortError ? t('settings.dataImport.keyTooShortError') : undefined}
            />
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

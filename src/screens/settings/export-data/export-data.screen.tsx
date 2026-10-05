import { match } from 'ts-pattern';
import { confirmOwner } from '@kiko/auth';
import { Alert, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { exportData } from '@kiko/data-transfer';
import { copySensitiveText } from '@kiko/clipboard';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import Switch from '@kiko/design-system/components/switch';
import { type FC, useEffect, useRef, useState } from 'react';
import SettingsRow from '@kiko/screens/settings/settings-row';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { styles } from './export-data.styles';

type ExportDataScreenProps = NativeStackScreenProps<SettingsStackParamList, 'ExportData'>;

// How long the Copy Key button shows "Copied" feedback before reverting to
// its normal label — the iOS-standard copy-confirmation duration.
const COPIED_FEEDBACK_DURATION_MS = 2000;

// `Share.share`'s `url` field needs an actual URL — a BARE filesystem path
// (what `exportData` returns) can silently no-op on iOS instead of attaching
// the file, with no error thrown and no share sheet shown, which reads on
// device as "Export does nothing". Prefixing the `file://` scheme is the
// fix; the `startsWith` guard makes this a no-op if a future caller ever
// hands in an already-schemed URL.
const toFileShareUrl = (path: string): string =>
  path.startsWith('file://') ? path : `file://${path}`;

const ExportDataScreen: FC<ExportDataScreenProps> = () => {
  const { t } = useTranslation();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [keyBase64, setKeyBase64] = useState<string | undefined>(undefined);
  const [fileUri, setFileUri] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(copiedTimeoutRef.current);
    },
    [],
  );

  const runExport = async (): Promise<void> => {
    if (includeSecrets) {
      const owner = await confirmOwner(t('auth.reason.exportSecrets'));

      const confirmed = match(owner)
        .with({ kind: 'confirmed' }, () => true)
        .with({ kind: 'cancelled' }, () => false)
        // No owner authentication exists on a passcode-less device — unlike
        // disabling the lock, there is no passcode sheet this could show, so
        // the export is refused rather than let through unauthenticated.
        .with({ kind: 'noPasscode' }, () => {
          Alert.alert(t('auth.reauth.passcodeRequiredTitle'), t('auth.reauth.passcodeRequired'));

          return false;
        })
        .with({ kind: 'failed' }, (result) => {
          Alert.alert(t('auth.reauth.failedTitle'), t(result.hintKey));

          return false;
        })
        .exhaustive();

      if (!confirmed) {
        return;
      }
    }

    try {
      const result = await exportData({ includeSecrets });
      setKeyBase64(result.keyBase64);
      setFileUri(result.fileUri);
      // A fresh key was never copied, so any "Copied" feedback left over from
      // a PRIOR key would mislead the "save this key, it will not be shown
      // again" warning — reset it and drop the stale pending revert timeout.
      clearTimeout(copiedTimeoutRef.current);
      setCopied(false);

      // Device report: pressing Export could look like it did nothing — the
      // key card below is real content one has to notice/scroll to. Opening
      // the OS share sheet immediately makes a successful export VISIBLE
      // right away, the same action the card's own Share File button
      // performs below (which stays as the manual fallback regardless of
      // this outcome). A dismiss/cancel here is the expected common case —
      // the same silent-catch convention as every other picker/share cancel
      // in this app — not a failure to surface.
      try {
        await Share.share({ url: toFileShareUrl(result.fileUri) });
      } catch {
        // Dismissed/cancelled the share sheet.
      }
    } catch {
      alertOnCatch(t, 'settings.dataExport.errorTitle', 'settings.dataExport.errorMessage');
    }
  };

  const { onPress: handleExport, isSubmitting } = useSubmitOnce(runExport);

  const handleCopyKey = (): void => {
    if (keyBase64 !== undefined) {
      copySensitiveText(keyBase64);
      setCopied(true);
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, COPIED_FEEDBACK_DURATION_MS);
    }
  };

  const handleShareFile = (): void => {
    if (fileUri !== undefined) {
      // The share sheet reports its own outcome to the user; the file stays exported either way.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(no recovery)
      Share.share({ url: toFileShareUrl(fileUri) });
    }
  };

  return (
    <Screen
      scroll
      footer={
        <Box direction="row" gap={2}>
          <Button
            testID="settings-button-export"
            variant="primary"
            onPress={handleExport}
            disabled={isSubmitting}
          >
            {t('settings.dataExport.exportButton')}
          </Button>
        </Box>
      }
    >
      <Box gap={4}>
        <Card testID="settings-card-export-secrets" padding={3}>
          {/* The toggle sits INLINE with its own label, not stacked below it —
              `SettingsRow`'s `trailing` prop puts it on the same header line
              as the leading icon + label; the hint stays full-width
              `children` below, same as before. */}
          <SettingsRow
            icon="key"
            label={t('settings.dataExport.includeSecrets')}
            trailing={
              <Switch
                testID="settings-switch-export-secrets"
                value={includeSecrets}
                onValueChange={setIncludeSecrets}
              />
            }
          >
            <Text variant="caption" tone="textSecondary">
              {t('settings.dataExport.includeSecretsHint')}
            </Text>
          </SettingsRow>
        </Card>

        <Text variant="body" tone="textSecondary">
          {t('settings.dataExport.description')}
        </Text>

        {keyBase64 !== undefined && (
          <Card testID="settings-card-export-key" padding={3}>
            {/* No uniform `gap` here — see `export-data.styles.ts`'s
                `keyWarning`/`keyField` doc comments: each child states its
                own trailing space explicitly, so the field's spacing stays
                correct regardless of whether `TextField` itself reserves any
                space of its own below the input. */}
            <Box>
              <Box style={styles.keyWarning}>
                <Text variant="body" tone="textPrimary">
                  {t('settings.dataExport.keyWarning')}
                </Text>
              </Box>

              <Box style={styles.keyField}>
                <TextField
                  label={t('settings.dataExport.keyLabel')}
                  value={keyBase64}
                  onChangeText={() => {}}
                  editable={false}
                  multiline
                />
              </Box>

              <Box direction="row" gap={3}>
                <Button
                  testID="settings-button-copy-key"
                  variant="secondaryTonal"
                  onPress={handleCopyKey}
                >
                  {copied ? t('settings.dataExport.copied') : t('settings.dataExport.copyKey')}
                </Button>
                <Button
                  testID="settings-button-share-file"
                  variant="secondaryTonal"
                  onPress={handleShareFile}
                >
                  {t('settings.dataExport.shareFile')}
                </Button>
              </Box>
            </Box>
          </Card>
        )}
      </Box>
    </Screen>
  );
};

export default ExportDataScreen;

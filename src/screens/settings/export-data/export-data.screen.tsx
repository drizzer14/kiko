import type { FC } from 'react';
import { Alert, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
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

import { styles } from './export-data.styles';

type ExportDataScreenProps = NativeStackScreenProps<SettingsStackParamList, 'ExportData'>;

// How long the Copy Key button shows "Copied" feedback before reverting to
// its normal label — the iOS-standard copy-confirmation duration.
const COPIED_FEEDBACK_DURATION_MS = 2000;

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
    try {
      const result = await exportData({ includeSecrets });
      setKeyBase64(result.keyBase64);
      setFileUri(result.fileUri);
      // A fresh key was never copied, so any "Copied" feedback left over from
      // a PRIOR key would mislead the "save this key, it will not be shown
      // again" warning — reset it and drop the stale pending revert timeout.
      clearTimeout(copiedTimeoutRef.current);
      setCopied(false);
    } catch {
      Alert.alert(t('settings.dataExport.errorTitle'), t('settings.dataExport.errorMessage'));
    }
  };

  const { onPress: handleExport, isSubmitting } = useSubmitOnce(runExport);

  const handleCopyKey = (): void => {
    if (keyBase64 !== undefined) {
      Clipboard.setString(keyBase64);
      setCopied(true);
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, COPIED_FEEDBACK_DURATION_MS);
    }
  };

  const handleShareFile = (): void => {
    if (fileUri !== undefined) {
      Share.share({ url: fileUri });
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
            fullWidth
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
          {/* The toggle sits INLINE with its own label (device-feedback-round-3
              item 5), not stacked below it — `SettingsRow`'s `trailing` prop
              puts it on the same header line as the leading icon + label; the
              hint stays full-width `children` below, same as before. */}
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
                `keyWarning` doc comment for why the TextField's own trailing
                space is deliberately left alone instead of adding a second
                gap on top of it. */}
            <Box>
              <Box style={styles.keyWarning}>
                <Text variant="body" tone="textPrimary">
                  {t('settings.dataExport.keyWarning')}
                </Text>
              </Box>

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

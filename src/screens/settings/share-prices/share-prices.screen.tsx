import { EODHD_SIGNUP_URL } from '@env';
import type { TFunction } from 'i18next';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { withUserLimits } from '@kiko/prices/quote-quota';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { clearEodhdKey, hasEodhdKey, saveEodhdKey } from '@kiko/prices/eodhd-key';
import ClipboardTextField from '@kiko/design-system/components/clipboard-text-field';
import { EodhdAuthError, fetchUserLimits, type UserLimits } from '@kiko/prices/eodhd';
import SyncStatusLine, { type SyncStatus } from '@kiko/design-system/components/sync-status-line';

type SharePricesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'SharePrices'>;

const failedCheckStatus = (error: unknown, t: TFunction): SyncStatus =>
  error instanceof EodhdAuthError
    ? { kind: 'invalid', message: t('settings.sharePricesScreen.invalidKeyError') }
    : { kind: 'saveError', message: t('settings.sharePricesScreen.unavailableError') };

const SharePricesScreen: FC<SharePricesScreenProps> = () => {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [showKeyRequiredError, setShowKeyRequiredError] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  // A saved key is shown only as this flag: the key itself is never read back
  // into the React tree, where a debugger can read the JS heap.
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [dailyLimit, setDailyLimit] = useState<number | undefined>(undefined);
  const [removePending, setRemovePending] = useState(false);

  useEffect(() => {
    hasEodhdKey().then(setIsKeySaved, () => setIsKeySaved(false));
  }, []);

  const handleChangeKey = (value: string): void => {
    setKey(value);
    setStatus({ kind: 'idle' });
    setShowKeyRequiredError(false);
  };

  // Only a key EODHD accepts is stored, so a typo never becomes a saved key
  // that fails every later refresh.
  const runSave = async (): Promise<void> => {
    const trimmed = key.trim();

    if (trimmed === '') {
      setShowKeyRequiredError(true);

      return;
    }

    setStatus({ kind: 'checking' });

    let limits: UserLimits;

    try {
      limits = await fetchUserLimits(trimmed);
    } catch (error) {
      setStatus(failedCheckStatus(error, t));

      return;
    }

    // The quota first: a key saved without its own limit would be refreshed
    // under the free plan's limit.
    try {
      await settingsRepo.updateQuoteQuota((stored) => withUserLimits(stored, limits, Date.now()));
      await saveEodhdKey(trimmed);
    } catch {
      setStatus({ kind: 'idle' });
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    setKey('');
    setStatus({ kind: 'idle' });
    setIsKeySaved(true);
    setDailyLimit(limits.dailyLimit);
  };

  const { onPress: handleSave, isSubmitting } = useSubmitOnce(runSave);

  const runRemove = async (): Promise<void> => {
    setRemovePending(false);

    try {
      await clearEodhdKey();
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    setIsKeySaved(false);
    setDailyLimit(undefined);
  };

  const { onPress: handleConfirmRemove } = useSubmitOnce(runRemove);

  return (
    <Screen
      scroll
      footer={
        <Box direction="row" gap={2}>
          <Button
            testID="settings-button-save-eodhd-key"
            variant="primary"
            fullWidth
            onPress={handleSave}
            disabled={isSubmitting}
          >
            {t('settings.sharePricesScreen.saveKey')}
          </Button>
        </Box>
      }
    >
      <Box gap={4}>
        <Text variant="body" tone="textSecondary">
          {t('settings.sharePricesScreen.intro')}
        </Text>

        {isKeySaved && (
          <Card testID="settings-card-eodhd-saved-key" padding={3}>
            <Box gap={3}>
              <SyncStatusLine
                status={{ kind: 'success', message: t('settings.sharePricesScreen.keySaved') }}
              />

              {dailyLimit !== undefined && (
                <Text variant="caption" tone="textSecondary">
                  {t('settings.sharePricesScreen.dailyLimit', { limit: dailyLimit })}
                </Text>
              )}

              <Button
                testID="settings-button-remove-eodhd-key"
                variant="destructiveTonal"
                size="small"
                fullWidth={false}
                icon="trash"
                onPress={() => setRemovePending(true)}
              >
                {t('settings.sharePricesScreen.removeKey')}
              </Button>
            </Box>
          </Card>
        )}

        <Card testID="settings-card-eodhd-key" padding={3}>
          <Box gap={3}>
            <ClipboardTextField
              label={t('settings.sharePricesScreen.keyLabel')}
              value={key}
              onChangeText={handleChangeKey}
              placeholder={t('settings.sharePricesScreen.keyPlaceholder')}
              pasteAccessibilityLabel={t('settings.sharePricesScreen.pasteAccessibilityLabel')}
              secureTextEntry
              error={
                showKeyRequiredError ? t('settings.sharePricesScreen.keyRequiredError') : undefined
              }
            />

            {/* Plain text, not a styled link: a link to the provider could read
                as a partnership. */}
            <Text variant="caption" tone="textSecondary">
              {t('settings.sharePricesScreen.signUpHint', { url: EODHD_SIGNUP_URL })}
            </Text>

            <SyncStatusLine status={status} />
          </Box>
        </Card>
      </Box>

      <ConfirmSheet
        visible={removePending}
        title={t('settings.sharePricesScreen.removeConfirmTitle')}
        message={t('settings.sharePricesScreen.removeConfirmBody')}
        confirmLabel={t('settings.sharePricesScreen.removeKey')}
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemovePending(false)}
        destructive
        confirmTestID="settings-confirm-remove-eodhd-key"
      />
    </Screen>
  );
};

export default SharePricesScreen;

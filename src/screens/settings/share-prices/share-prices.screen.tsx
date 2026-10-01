import {
  EodhdAuthError,
  fetchUserLimits,
  EodhdQuotaError,
  EodhdRateLimitError,
} from '@kiko/prices/eodhd';
import {
  markUsedUp,
  currentQuota,
  withUserLimits,
  type QuoteQuota,
  withUnconfirmedLimit,
} from '@kiko/prices/quote-quota';
import { match, P } from 'ts-pattern';
import { EODHD_SIGNUP_URL } from '@env';
import { useLiveQuery } from '@kiko/db';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { logFailure } from '@kiko/diagnostics';
import { Linking, Pressable } from 'react-native';
import { type FC, useEffect, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { confirmDailyLimit } from '@kiko/prices/daily-limit';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { clearEodhdKey, hasEodhdKey, saveEodhdKey } from '@kiko/prices/eodhd-key';
import ClipboardTextField from '@kiko/design-system/components/clipboard-text-field';
import SyncStatusLine, { type SyncStatus } from '@kiko/design-system/components/sync-status-line';

import { styles } from './share-prices.styles';

type SharePricesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'SharePrices'>;

type QuotaUpdate = (stored: QuoteQuota | null) => QuoteQuota | null;

const failedCheckStatus = (error: unknown, t: TFunction): SyncStatus =>
  error instanceof EodhdAuthError
    ? { kind: 'invalid', message: t('settings.sharePricesScreen.invalidKeyError') }
    : { kind: 'saveError', message: t('settings.sharePricesScreen.unavailableError') };

// A daily or per-minute limit is not a rejection of the key, so the key is
// stored, with a daily limit EODHD has yet to confirm (the next open of this
// screen reads it); a daily limit also marks the day used up, which this
// screen shows.
const acceptedKeyQuota = (error: unknown): QuotaUpdate | undefined =>
  match(error)
    .with(
      P.instanceOf(EodhdQuotaError),
      (): QuotaUpdate => (stored) =>
        markUsedUp(withUnconfirmedLimit(currentQuota(stored, Date.now()))),
    )
    .with(
      P.instanceOf(EodhdRateLimitError),
      (): QuotaUpdate => (stored) => withUnconfirmedLimit(currentQuota(stored, Date.now())),
    )
    .otherwise(() => undefined);

type RequestsToday = { used: number; limit: number; isUsedUp: boolean };

const requestsTodayOf = (stored: QuoteQuota | null, now: number): RequestsToday => {
  const quota = currentQuota(stored, now);

  return {
    used: Math.min(quota.calls, quota.dailyLimit),
    limit: quota.dailyLimit,
    isUsedUp: stored?.day === quota.day && quota.calls >= quota.dailyLimit,
  };
};

const formatCount = (count: number): string => count.toLocaleString(activeLocale());

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
  const { data: quotaRows, isLoading: isQuotaLoading } = useLiveQuery(
    settingsRepo.quoteQuotaQuery(),
    ['settings'],
  );
  // Nothing about today's requests shows before the stored quota has loaded:
  // its default would read as "0 used" for a moment.
  const requestsToday =
    isKeySaved && !isQuotaLoading
      ? requestsTodayOf(quotaRows.at(0)?.quoteQuota ?? null, Date.now())
      : undefined;
  const signUpHint = t('settings.sharePricesScreen.signUpHint', { url: EODHD_SIGNUP_URL });

  useEffect(() => {
    hasEodhdKey().then(setIsKeySaved, () => setIsKeySaved(false));
  }, []);

  useEffect(() => {
    confirmDailyLimit().catch((error: unknown) =>
      logFailure('[share-prices] daily limit check failed', error),
    );
  }, []);

  const handleChangeKey = (value: string): void => {
    setKey(value);
    setStatus({ kind: 'idle' });
    setShowKeyRequiredError(false);
  };

  const handleOpenSignUp = (): void => {
    Linking.openURL(EODHD_SIGNUP_URL);
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

    let updateQuota: QuotaUpdate;
    let limit: number | undefined;

    try {
      const limits = await fetchUserLimits(trimmed);

      updateQuota = (stored) => withUserLimits(stored, limits, Date.now());
      limit = limits.dailyLimit;
    } catch (error) {
      const accepted = acceptedKeyQuota(error);

      if (accepted === undefined) {
        setStatus(failedCheckStatus(error, t));

        return;
      }

      updateQuota = accepted;
    }

    // The quota first: a key saved without its own limit would be refreshed
    // under the free plan's limit.
    try {
      await settingsRepo.updateQuoteQuota(updateQuota);
      await saveEodhdKey(trimmed);
    } catch {
      setStatus({ kind: 'idle' });
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    setKey('');
    setStatus({ kind: 'idle' });
    setIsKeySaved(true);
    setDailyLimit(limit);
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
            onPress={handleSave}
            disabled={isSubmitting}
          >
            {t('settings.sharePricesScreen.saveKey')}
          </Button>
        </Box>
      }
    >
      <Box gap={4}>
        {requestsToday?.isUsedUp === true && (
          <NoticeBanner
            message={t('settings.sharePricesScreen.quotaUsedUpMessage')}
            testID="share-prices-quota-banner"
          />
        )}

        <Text variant="body" tone="textSecondary">
          {t('settings.sharePricesScreen.intro')}
        </Text>

        {isKeySaved && (
          <Card testID="settings-card-eodhd-saved-key" padding={3}>
            <Box gap={3}>
              <SyncStatusLine
                status={{ kind: 'success', message: t('settings.sharePricesScreen.keySaved') }}
              />

              {foldMap(maybe(dailyLimit), (limit) => (
                <Text variant="caption" tone="textSecondary">
                  {t('settings.sharePricesScreen.dailyLimit', { limit: formatCount(limit) })}
                </Text>
              ))}

              {foldMap(maybe(requestsToday), ({ used, limit }) => (
                <Text variant="caption" tone="textSecondary">
                  {t('settings.sharePricesScreen.requestsToday', {
                    used: formatCount(used),
                    limit: formatCount(limit),
                  })}
                </Text>
              ))}

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

            <Pressable
              accessibilityRole="link"
              accessibilityLabel={signUpHint}
              onPress={handleOpenSignUp}
              style={styles.signUpLink}
            >
              <Text variant="caption" tone="accent">
                {signUpHint}
              </Text>
            </Pressable>

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

import { useTranslation } from 'react-i18next';
import { type RefObject, useMemo, useRef, useState } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

const connectSources = ['monobank', 'binance', 'wallet'] as const;
type ConnectSource = (typeof connectSources)[number];

// The Connect button each hint names, so the hint reads as the label the user sees.
const BUTTON_LABEL_KEY = {
  monobank: 'accountDetail.connectMonobank',
  binance: 'accountDetail.connectBinance',
  wallet: 'accountDetail.connectWallet',
} as const;

type SourceFlags = Record<ConnectSource, boolean>;

const NO_SOURCES: SourceFlags = { monobank: false, binance: false, wallet: false };

type ConnectReminderControls = {
  // What to hand the source's Connect field so it reports its input and shows the hint.
  reminderFor: (source: ConnectSource) => ConnectReminder;
  // Whether this Save press was spent on a reminder instead of saving.
  remindOnSave: () => boolean;
};

/**
 * Remembers which Connect field holds typed input, and turns the first Save press on it into a
 * reminder. A second Save press with the input unchanged saves the account without that
 * connection. Editing the input, pressing Connect, or the field going away starts over. A field
 * reports no typed input once its connect succeeds, so a connected source is not reminded of
 * until it is edited again. The input itself stays inside its field: this only knows whether
 * anything is typed.
 */
export const useConnectReminder = (
  scrollTo: (fieldRef: RefObject<FieldInstance | null>) => void,
): ConnectReminderControls => {
  const { t } = useTranslation();
  const [typed, setTyped] = useState<SourceFlags>(NO_SOURCES);
  const [reminded, setReminded] = useState<ConnectSource | null>(null);
  const monobankRef = useRef<FieldInstance>(null);
  const binanceRef = useRef<FieldInstance>(null);
  const walletRef = useRef<FieldInstance>(null);
  const fieldRefs = { monobank: monobankRef, binance: binanceRef, wallet: walletRef };

  // Stable per source: a field reports "not typed" when its callback changes or it unmounts, so a
  // fresh function on every render would clear the draft it had just reported.
  const callbacks = useMemo(() => {
    const forSource = (source: ConnectSource) => ({
      onDraftChange: (hasDraft: boolean): void => {
        setTyped((current) => ({ ...current, [source]: hasDraft }));
        setReminded(null);
      },
      onConnectPress: (): void => setReminded(null),
    });

    return {
      monobank: forSource('monobank'),
      binance: forSource('binance'),
      wallet: forSource('wallet'),
    };
  }, []);

  const reminderFor = (source: ConnectSource): ConnectReminder => ({
    ref: fieldRefs[source],
    message:
      reminded === source
        ? t('forms.account.connectHint', { label: t(BUTTON_LABEL_KEY[source]) })
        : undefined,
    ...callbacks[source],
  });

  const remindOnSave = (): boolean => {
    const source = connectSources.find((candidate) => typed[candidate]);

    if (source === undefined || reminded === source) {
      return false;
    }

    setReminded(source);
    scrollTo(fieldRefs[source]);

    return true;
  };

  return { reminderFor, remindOnSave };
};

import { useTranslation } from 'react-i18next';
import { type RefObject, useMemo, useRef, useState } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

const connectSources = ['monobank', 'binance', 'wallet'] as const;
type ConnectSource = (typeof connectSources)[number];

const HINT_KEY = {
  monobank: 'forms.account.connectMonobankHint',
  binance: 'forms.account.connectBinanceHint',
  wallet: 'forms.account.connectWalletHint',
} as const;

type SourceFlags = Record<ConnectSource, boolean>;

const NO_SOURCES: SourceFlags = { monobank: false, binance: false, wallet: false };

type ConnectReminderControls = {
  // What to hand the source's Connect field so it reports its input and shows the hint.
  reminderFor: (source: ConnectSource) => ConnectReminder;
  // Wraps a source's connect action, so a connection that succeeded stops being reminded of.
  trackConnect: <Args extends unknown[]>(
    source: ConnectSource,
    connect: (...args: Args) => Promise<boolean>,
  ) => (...args: Args) => Promise<boolean>;
  // Whether this Save press was spent on a reminder instead of saving.
  remindOnSave: () => boolean;
};

/**
 * Remembers which Connect field holds typed input that was never connected, and turns the first
 * Save press on it into a reminder. A second Save press with the input unchanged saves the account
 * without that connection. Editing the input, pressing Connect, or the field going away starts
 * over. The input itself stays inside its field: this only knows whether anything is typed.
 */
export const useConnectReminder = (
  scrollTo: (fieldRef: RefObject<FieldInstance | null>) => void,
): ConnectReminderControls => {
  const { t } = useTranslation();
  const [typed, setTyped] = useState<SourceFlags>(NO_SOURCES);
  const [connected, setConnected] = useState<SourceFlags>(NO_SOURCES);
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
    message: reminded === source ? t(HINT_KEY[source]) : undefined,
    ...callbacks[source],
  });

  const trackConnect = <Args extends unknown[]>(
    source: ConnectSource,
    connect: (...args: Args) => Promise<boolean>,
  ) => {
    return async (...args: Args): Promise<boolean> => {
      const succeeded = await connect(...args);

      if (succeeded) {
        setConnected((current) => ({ ...current, [source]: true }));
      }

      return succeeded;
    };
  };

  const remindOnSave = (): boolean => {
    const source = connectSources.find((candidate) => typed[candidate] && !connected[candidate]);

    if (source === undefined || reminded === source) {
      return false;
    }

    setReminded(source);
    scrollTo(fieldRefs[source]);

    return true;
  };

  return { reminderFor, trackConnect, remindOnSave };
};

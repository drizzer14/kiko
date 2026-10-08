import { useRef, useState } from 'react';
import { settingsRepo } from '@kiko/settings';
import { logOnFailure } from '@kiko/diagnostics';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import type { ImportResult } from '@kiko/statement-import/import-statement';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type ImportResultNavigation = Pick<
  NativeStackNavigationProp<AccountsStackParamList>,
  'popTo' | 'goBack'
>;

type UseImportResultSheetParams = {
  navigation: ImportResultNavigation;
  accountId: string;
  // `undefined` while the account row has not loaded: the close then goes back
  // instead of popping to an `AccountDetail` that was never on this stack.
  accountName: string | undefined;
};

type ImportResultSheetControls = {
  sheetProps: {
    visible: boolean;
    result: ImportResult | undefined;
    onDone: () => void;
    onClosed: () => void;
  };
  show: (result: ImportResult) => void;
};

/**
 * The state of the "import finished" sheet both statement-import screens show,
 * and the one navigation that follows it.
 *
 * `visible` is decoupled from `result`, and `result` is never cleared, so the
 * sheet's last content stays correct for the whole close animation. `onDone`
 * only closes the sheet: a native-stack pop must wait for the sheet to ACTUALLY
 * finish closing, which only `onClosed` (the sheet's real completion signal)
 * promises. `onClosed` navigates at most once, however often the sheet reports
 * it.
 *
 * `popTo`, not `navigate`: on React Navigation 7 `navigate` pushes a DUPLICATE
 * of an already-on-stack route instead of reusing it, and both import screens
 * were pushed from `AccountDetail`, however many screens deep the import ran
 * (see `src/navigation/root-navigator/statement-import-return.navigator.test.tsx`
 * for the real-router proof).
 *
 * The caller reads the account name at render, and `onClosed` is recreated on
 * every render, so the name the close sees is the one of the render that
 * handed the sheet its `onClosed`.
 */
export const useImportResultSheet = ({
  navigation,
  accountId,
  accountName,
}: UseImportResultSheetParams): ImportResultSheetControls => {
  const [result, setResult] = useState<ImportResult | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const navigatedAwayRef = useRef(false);
  // A finished import ends the import tip's job, even one that added no row. The sheet shows
  // first, and a failed dismiss only leaves the tip on screen, so there is no alert.
  const show = async (shown: ImportResult): Promise<void> => {
    setResult(shown);
    setVisible(true);
    await logOnFailure('tips.dismiss', () =>
      settingsRepo.dismissTip('accountDetail.importStatement'),
    );
  };

  const onDone = (): void => {
    setVisible(false);
  };

  const onClosed = (): void => {
    if (navigatedAwayRef.current) {
      return;
    }

    navigatedAwayRef.current = true;

    if (accountName === undefined) {
      navigation.goBack();

      return;
    }

    navigation.popTo(
      'AccountDetail',
      { accountId, name: accountName, reminderOffer: 'afterImport' },
      { merge: true },
    );
  };

  return { sheetProps: { visible, result, onDone, onClosed }, show };
};

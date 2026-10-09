import { act, renderHook } from '@testing-library/react-native';
import type { ImportResult } from '@kiko/statement-import/import-statement';
import { asNavigationProp, navigationSpy } from '@kiko/test-support/navigation-props';

import { useImportResultSheet, type ImportResultNavigation } from './use-import-result-sheet';

const importResult: ImportResult = {
  formatId: 'monobank-csv',
  imported: 3,
  total: 4,
  skippedWrongCurrency: 0,
  skippedWrongCurrencyCodes: [],
};

const setup = async (accountName: string | undefined) => {
  const navigation = navigationSpy();
  const view = await renderHook(
    (props: { accountName: string | undefined }) =>
      useImportResultSheet({
        navigation: asNavigationProp<ImportResultNavigation>(navigation),
        accountId: 'a',
        accountName: props.accountName,
      }),
    { initialProps: { accountName } },
  );

  return { ...view, navigation };
};

describe('useImportResultSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the sheet at once, with nothing to await', async () => {
    const { result } = await setup('Monobank');
    let returned: unknown = 'not called';

    await act(async () => {
      returned = result.current.show(importResult);
    });

    expect(returned).toBeUndefined();
  });

  it('starts hidden with no result', async () => {
    const { result } = await setup('Monobank');

    expect(result.current.sheetProps.visible).toBe(false);
    expect(result.current.sheetProps.result).toBeUndefined();
  });

  it('shows the sheet with the result it is given', async () => {
    const { result } = await setup('Monobank');

    await act(async () => {
      result.current.show(importResult);
    });

    expect(result.current.sheetProps.visible).toBe(true);
    expect(result.current.sheetProps.result).toBe(importResult);
  });

  it('closes on done, keeps the last result for the closing animation, and does not navigate', async () => {
    const { result, navigation } = await setup('Monobank');
    await act(async () => {
      result.current.show(importResult);
    });

    await act(async () => {
      result.current.sheetProps.onDone();
    });

    expect(result.current.sheetProps.visible).toBe(false);
    expect(result.current.sheetProps.result).toBe(importResult);
    expect(navigation.popTo).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('pops to the account page asking for the import reminder offer once the sheet has closed', async () => {
    const { result, navigation } = await setup('Monobank');

    result.current.sheetProps.onClosed();

    expect(navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'Monobank', reminderOffer: 'afterImport' },
      { merge: true },
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('goes back instead of popping to a page that was never on the stack, when the account is not loaded', async () => {
    const { result, navigation } = await setup(undefined);

    result.current.sheetProps.onClosed();

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.popTo).not.toHaveBeenCalled();
  });

  it('keeps an account name that is an empty string a loaded account', async () => {
    const { result, navigation } = await setup('');

    result.current.sheetProps.onClosed();

    expect(navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: '', reminderOffer: 'afterImport' },
      { merge: true },
    );
  });

  it('navigates at most once when the sheet reports closed again', async () => {
    const { result, navigation } = await setup('Monobank');

    result.current.sheetProps.onClosed();
    result.current.sheetProps.onClosed();

    expect(navigation.popTo).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('reads the account name of the latest render when the sheet reports closed', async () => {
    const { result, rerender, navigation } = await setup(undefined);

    await rerender({ accountName: 'Monobank' });
    result.current.sheetProps.onClosed();

    expect(navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      expect.objectContaining({ name: 'Monobank' }),
      { merge: true },
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

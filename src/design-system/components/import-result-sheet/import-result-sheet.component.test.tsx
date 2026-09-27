import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import ImportResultSheet from './import-result-sheet.component';

const RESULT = {
  formatId: 'monobank-csv' as const,
  imported: 3,
  total: 4,
  skippedWrongCurrency: 0,
  skippedWrongCurrencyCodes: [],
};

describe('ImportResultSheet', () => {
  // `visible` and `result` are decoupled props — a
  // caller can close the sheet (visible=false) while still holding the
  // last `result`.
  it('renders nothing while not visible, even with a result', async () => {
    const { queryByText } = await render(
      <ImportResultSheet visible={false} result={RESULT} onDone={jest.fn()} onClosed={jest.fn()} />,
    );

    expect(queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
  });

  it('shows the title and the same result text ImportOutcome renders inline', async () => {
    const { getByText } = await render(
      <ImportResultSheet visible result={RESULT} onDone={jest.fn()} onClosed={jest.fn()} />,
    );

    expect(getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy();
    expect(
      getByText(i18n.t('statementImport.importedCount', { imported: 3, total: 4 })),
    ).toBeTruthy();
  });

  it('calls onDone when the Done button is pressed', async () => {
    const onDone = jest.fn();
    const { getByText } = await render(
      <ImportResultSheet visible result={RESULT} onDone={onDone} onClosed={jest.fn()} />,
    );

    await fireEvent.press(getByText(i18n.t('common.done')));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onDone on a scrim dismiss', async () => {
    const onDone = jest.fn();
    const { getByTestId } = await render(
      <ImportResultSheet visible result={RESULT} onDone={onDone} onClosed={jest.fn()} />,
    );

    await fireEvent.press(getByTestId('import-result-sheet-backdrop'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // `onClosed` is BottomSheet's pass-through of RN
  // Modal's real onDismiss — distinct from onDone (a mere close request).
  it('calls onClosed when the underlying sheet reports it has actually finished closing', async () => {
    const onClosed = jest.fn();
    const { getByTestId } = await render(
      <ImportResultSheet visible result={RESULT} onDone={jest.fn()} onClosed={onClosed} />,
    );

    await fireEvent(getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

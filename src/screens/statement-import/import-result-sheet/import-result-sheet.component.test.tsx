import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';

import { i18n } from '../../../i18n';

import ImportResultSheet from './import-result-sheet.component';

const RESULT = {
  formatId: 'monobank-csv' as const,
  imported: 3,
  total: 4,
  skippedWrongCurrency: 0,
};

describe('ImportResultSheet', () => {
  // Ponytail review (fix round 1): visibility is DERIVED from `result`
  // (`result !== undefined`) — there is no separate `visible` prop.
  it('renders nothing when result is undefined', async () => {
    const { queryByText } = await render(
      <ImportResultSheet result={undefined} onDone={jest.fn()} />,
    );

    expect(queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
  });

  it('shows the title and the same result text ImportOutcome renders inline', async () => {
    const { getByText } = await render(<ImportResultSheet result={RESULT} onDone={jest.fn()} />);

    expect(getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy();
    expect(
      getByText(i18n.t('statementImport.importedCount', { imported: 3, total: 4 })),
    ).toBeTruthy();
  });

  it('calls onDone when the Done button is pressed', async () => {
    const onDone = jest.fn();
    const { getByText } = await render(<ImportResultSheet result={RESULT} onDone={onDone} />);

    await fireEvent.press(getByText(i18n.t('common.done')));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onDone on a scrim dismiss', async () => {
    const onDone = jest.fn();
    const { getByTestId } = await render(<ImportResultSheet result={RESULT} onDone={onDone} />);

    await fireEvent.press(getByTestId('import-result-sheet-backdrop'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

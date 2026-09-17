import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';

import { i18n } from '../../../i18n';

import ImportOutcome from './import-outcome.component';

describe('ImportOutcome', () => {
  it('renders nothing but an empty fragment when neither error nor result is given', async () => {
    const { queryByText } = await render(<ImportOutcome />);

    expect(queryByText(/./)).toBeNull();
  });

  it('renders the caught error message', async () => {
    const { getByText } = await render(<ImportOutcome error="Something went wrong" />);

    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('renders the imported/total count', async () => {
    const { getByText } = await render(
      <ImportOutcome
        result={{ formatId: 'monobank-csv', imported: 3, total: 4, skippedWrongCurrency: 0 }}
      />,
    );

    expect(
      getByText(i18n.t('statementImport.importedCount', { imported: 3, total: 4 })),
    ).toBeTruthy();
  });

  it('renders no skipped-wrong-currency line when the count is zero', async () => {
    const { queryByText } = await render(
      <ImportOutcome
        result={{ formatId: 'monobank-csv', imported: 4, total: 4, skippedWrongCurrency: 0 }}
      />,
    );

    expect(queryByText(i18n.t('statementImport.skippedWrongCurrency', { count: 1 }))).toBeNull();
  });

  it('renders the skipped-wrong-currency line when the count is non-zero', async () => {
    const { getByText } = await render(
      <ImportOutcome
        result={{ formatId: 'privatbank-xlsx', imported: 1, total: 2, skippedWrongCurrency: 1 }}
      />,
    );

    expect(getByText(i18n.t('statementImport.skippedWrongCurrency', { count: 1 }))).toBeTruthy();
  });
});

import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '@kiko/i18n/init';

import AddBankProviderSheet, { visibleCatalogEntries } from '.';

describe('visibleCatalogEntries', () => {
  it('lists every wired provider catalog entry (Guideline 5.6 remediation: Monobank-only, unconditional)', () => {
    expect(visibleCatalogEntries().map((entry) => entry.id)).toEqual(['monobank']);
  });
});

describe('AddBankProviderSheet', () => {
  it('renders the wired catalog entries with their about + eligibility copy', async () => {
    const view = await render(
      <AddBankProviderSheet visible onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText(/Works with any personal Monobank account/)).toBeTruthy();
  });

  it('reports the chosen provider and closes the sheet on selection', async () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <AddBankProviderSheet visible onDismiss={onDismiss} onSelect={onSelect} />,
    );

    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(onSelect).toHaveBeenCalledWith('monobank');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', async () => {
    const view = await render(
      <AddBankProviderSheet visible={false} onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.queryByText('Monobank')).toBeNull();
  });
});

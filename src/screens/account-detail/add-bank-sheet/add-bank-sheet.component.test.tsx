import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import AddBankProviderSheet from '.';

describe('AddBankProviderSheet', () => {
  it('renders the wired catalog entries with their about + eligibility copy', async () => {
    const view = await render(
      <AddBankProviderSheet visible onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText('PrivatBank')).toBeTruthy();
    expect(view.getByText('bunq')).toBeTruthy();
    expect(view.getByText('Starling')).toBeTruthy();
    expect(view.getByText(/Works with any personal Monobank account/)).toBeTruthy();
    expect(view.getByText(/Requires a Privat24 business or individual-entrepreneur/)).toBeTruthy();
    expect(view.getByText(/bunq is a European mobile bank/)).toBeTruthy();
    expect(view.getByText(/Starling is a UK digital bank/)).toBeTruthy();
  });

  it('reports the chosen provider and closes the sheet on selection', async () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <AddBankProviderSheet visible onDismiss={onDismiss} onSelect={onSelect} />,
    );

    await fireEvent.press(view.getByTestId('add-bank-option-privatbank'));

    expect(onSelect).toHaveBeenCalledWith('privatbank');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', async () => {
    const view = await render(
      <AddBankProviderSheet visible={false} onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.queryByText('Monobank')).toBeNull();
  });
});

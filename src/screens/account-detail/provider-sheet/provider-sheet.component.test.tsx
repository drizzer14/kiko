import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import ProviderSheet from '.';

const monobankEntry = {
  id: 'monobank',
  label: 'Monobank',
  captions: ['Reads your Monobank account.', 'Works with any personal Monobank account.'],
  accessibilityLabel: 'Monobank',
};

describe('ProviderSheet', () => {
  it('renders the wired catalog entries with their about + eligibility copy', async () => {
    const view = await render(
      <ProviderSheet
        visible
        title="Add a Bank"
        entries={[monobankEntry]}
        onDismiss={jest.fn()}
        onSelect={jest.fn()}
        testIDPrefix="add-bank"
      />,
    );

    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText(/Works with any personal Monobank account/)).toBeTruthy();
  });

  it('renders the entries and title its caller passes', async () => {
    const view = await render(
      <ProviderSheet
        visible
        title="Pick a Provider"
        entries={[
          {
            id: 'alpha',
            label: 'Alpha',
            captions: ['First caption.'],
            accessibilityLabel: 'Alpha. First caption.',
          },
          { id: 'beta', label: 'Beta', captions: [], accessibilityLabel: 'Beta' },
        ]}
        onDismiss={jest.fn()}
        onSelect={jest.fn()}
        testIDPrefix="pick"
      />,
    );

    expect(view.getByText('Pick a Provider')).toBeTruthy();
    expect(view.getByTestId('pick-sheet')).toBeTruthy();
    expect(view.getByTestId('pick-option-alpha')).toBeTruthy();
    expect(view.getByTestId('pick-option-beta')).toBeTruthy();
    expect(view.getByText('First caption.')).toBeTruthy();
    expect(view.getByLabelText('Alpha. First caption.')).toBeTruthy();
  });

  it('reports the chosen provider and closes the sheet on selection', async () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <ProviderSheet
        visible
        title="Add a Bank"
        entries={[monobankEntry]}
        onDismiss={onDismiss}
        onSelect={onSelect}
        testIDPrefix="add-bank"
      />,
    );

    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(onSelect).toHaveBeenCalledWith('monobank');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', async () => {
    const view = await render(
      <ProviderSheet
        visible={false}
        title="Add a Bank"
        entries={[monobankEntry]}
        onDismiss={jest.fn()}
        onSelect={jest.fn()}
        testIDPrefix="add-bank"
      />,
    );

    expect(view.queryByText('Monobank')).toBeNull();
  });
});

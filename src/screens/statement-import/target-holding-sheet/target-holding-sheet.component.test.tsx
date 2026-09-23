import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import { navigationSpy } from '../../../test-support/navigation-props';

import TargetHoldingSheet from '.';
import type { TargetHoldingOption } from './target-holding-sheet.props';

const holdings: TargetHoldingOption[] = [
  { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
  { id: 'h2', name: 'Dollar jar', accountId: 'a', accountName: 'Monobank' },
  { id: 'h3', name: 'Savings', accountId: 'b', accountName: 'Ukrsibbank' },
];

describe('TargetHoldingSheet', () => {
  it('lists only the holdings scoped to accountId when it is provided', async () => {
    const view = await render(
      <TargetHoldingSheet
        visible
        onDismiss={jest.fn()}
        holdings={holdings}
        accountId="a"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    expect(view.getByText('Black card')).toBeTruthy();
    expect(view.getByText('Dollar jar')).toBeTruthy();
    expect(view.queryByText('Savings')).toBeNull();
  });

  it('lists every holding, grouped by account name, when accountId is absent', async () => {
    const view = await render(
      <TargetHoldingSheet
        visible
        onDismiss={jest.fn()}
        holdings={holdings}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    expect(view.getByText('Black card')).toBeTruthy();
    expect(view.getByText('Dollar jar')).toBeTruthy();
    expect(view.getByText('Savings')).toBeTruthy();
    // The cross-account (unscoped) list is grouped by account name — each
    // distinct account contributes its own group header.
    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText('Ukrsibbank')).toBeTruthy();
  });

  it('reports the chosen holding and closes the sheet on selection', async () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <TargetHoldingSheet
        visible
        onDismiss={onDismiss}
        holdings={holdings}
        accountId="a"
        onSelect={onSelect}
        onCreateNew={jest.fn()}
      />,
    );

    await fireEvent.press(view.getByTestId('target-holding-option-h2'));

    expect(onSelect).toHaveBeenCalledWith('h2');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('presses "Create new holding" through to the caller-supplied handler, which navigates to HoldingForm', async () => {
    const navigation = navigationSpy();
    const onCreateNew = jest.fn(() => navigation.navigate('HoldingForm', { accountId: 'a' }));
    const view = await render(
      <TargetHoldingSheet
        visible
        onDismiss={jest.fn()}
        holdings={holdings}
        accountId="a"
        onSelect={jest.fn()}
        onCreateNew={onCreateNew}
      />,
    );

    await fireEvent.press(view.getByTestId('target-holding-create-new'));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });

  it('renders nothing when not visible', async () => {
    const view = await render(
      <TargetHoldingSheet
        visible={false}
        onDismiss={jest.fn()}
        holdings={holdings}
        accountId="a"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    expect(view.queryByText('Black card')).toBeNull();
  });
});

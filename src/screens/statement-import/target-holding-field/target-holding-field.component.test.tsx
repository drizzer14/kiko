import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import type { TargetHoldingOption } from '../target-holding-sheet/target-holding-sheet.props';

import TargetHoldingField from '.';

const holdings: TargetHoldingOption[] = [
  {
    id: 'h1',
    name: 'Black card',
    accountId: 'a',
    accountName: 'Monobank',
    icon: 'creditcard',
    color: '#FFFFFF',
  },
  {
    id: 'h2',
    name: 'Dollar jar',
    accountId: 'a',
    accountName: 'Monobank',
    icon: 'rectangle.portrait',
    color: '#8E44AD',
  },
];

describe('TargetHoldingField', () => {
  it('shows the label as the placeholder value when nothing is selected', async () => {
    const { getAllByText } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId={undefined}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    // The FieldLabel caption AND the trigger's placeholder value both show
    // this text until a holding is picked.
    expect(getAllByText('Choose a holding').length).toBeGreaterThan(0);
  });

  it('shows the selected holding name as the trigger value once selected', async () => {
    const { getByText } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId="h2"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    expect(getByText('Dollar jar')).toBeTruthy();
  });

  // F3 item 3: the trigger shows the SELECTED holding's own icon.
  it('shows the selected holding’s own icon on the trigger', async () => {
    const { toJSON } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId="h2"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    );

    // The mocked SFSymbolView forwards `name` to a host View, so the
    // selected holding's icon name appears in the rendered tree.
    expect(JSON.stringify(toJSON())).toContain('rectangle.portrait');
  });

  it('opens the holding sheet on tap and reports a pick through onSelect', async () => {
    const onSelect = jest.fn();
    const view = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId={undefined}
        onSelect={onSelect}
        onCreateNew={jest.fn()}
        testID="target-holding-field"
      />,
    );

    await fireEvent.press(view.getByTestId('target-holding-field'));
    await fireEvent.press(view.getByTestId('target-holding-option-h1'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });
});

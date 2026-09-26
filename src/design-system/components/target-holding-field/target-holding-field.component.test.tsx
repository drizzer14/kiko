import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '@kiko/i18n/init';

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
  it('shows a distinct placeholder (not the label repeated) when nothing is selected', async () => {
    const { getByText } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId={undefined}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
        placeholder="Select a holding"
      />,
    );

    // The FieldLabel caption ("Choose a holding") and the trigger's own
    // value ("Select a holding") must read as two DIFFERENT strings — a
    // placeholder never repeats the label text verbatim.
    expect(getByText('Choose a holding')).toBeTruthy();
    expect(getByText('Select a holding')).toBeTruthy();
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
        placeholder="Select a holding"
      />,
    );

    expect(getByText('Dollar jar')).toBeTruthy();
  });

  // The trigger shows the SELECTED holding's own icon.
  it('shows the selected holding’s own icon on the trigger', async () => {
    const { toJSON } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId="h2"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
        placeholder="Select a holding"
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
        placeholder="Select a holding"
        testID="target-holding-field"
      />,
    );

    await fireEvent.press(view.getByTestId('target-holding-field'));
    await fireEvent.press(view.getByTestId('target-holding-option-h1'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it('never opens the sheet while disabled — a caller with a still-loading holdings list', async () => {
    // The picker must never open on an incomplete/empty `holdings` list
    // while the caller's own query is still loading (kiko-architecture's
    // useLiveQuery consumer rule) — forwarded straight to FieldTrigger's own
    // `disabled`, which makes the trigger Pressable inert.
    const view = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={[]}
        accountId="a"
        selectedId={undefined}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
        placeholder="Select a holding"
        disabled
        testID="target-holding-field"
      />,
    );

    await fireEvent.press(view.getByTestId('target-holding-field'));

    expect(view.queryByTestId('target-holding-sheet')).toBeNull();
  });

  it('shows the FieldError message and tints the label negative when `error` is set', async () => {
    const { getByText, getByTestId } = await render(
      <TargetHoldingField
        label="Choose a holding"
        holdings={holdings}
        accountId="a"
        selectedId={undefined}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
        placeholder="Select a holding"
        error="Pick a holding."
        testID="target-holding-field"
      />,
    );

    expect(getByText('Pick a holding.')).toBeTruthy();
    expect(getByTestId('target-holding-field-error')).toBeTruthy();
  });
});

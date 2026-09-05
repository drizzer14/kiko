import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';

import OptionPills from './option-pills.component';

describe('OptionPills', () => {
  it('renders one pressable pill per option, labelled by String() by default', async () => {
    const { getAllByRole, getByText } = await render(
      <OptionPills options={[0, 30, 60]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getAllByRole('button')).toHaveLength(3);
    expect(getByText('0')).toBeTruthy();
    expect(getByText('60')).toBeTruthy();
  });

  it('uses the label function when given', async () => {
    const { getByText } = await render(
      <OptionPills
        options={['a', 'b'] as const}
        selected="a"
        onSelect={jest.fn()}
        label={(o) => o.toUpperCase()}
      />,
    );

    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });

  it('renders an optional leading icon per option', async () => {
    const { toJSON } = await render(
      <OptionPills
        options={['a', 'b'] as const}
        selected="a"
        onSelect={jest.fn()}
        icon={(o) => `icon-${o}`}
      />,
    );

    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('icon-a');
    expect(tree).toContain('icon-b');
  });

  it('marks the selected pill via accessibilityState', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getByText('30').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('0').parent?.props.accessibilityState.selected).toBe(false);
  });

  it('reports the pressed option', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={0} onSelect={onSelect} />,
    );

    await fireEvent.press(getByText('30'));

    expect(onSelect).toHaveBeenCalledWith(30);
  });
});

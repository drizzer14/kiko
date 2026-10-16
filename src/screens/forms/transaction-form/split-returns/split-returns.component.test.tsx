import type { TFunction } from 'i18next';
import { render } from '@testing-library/react-native';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import SplitReturns from './split-returns.component';
import type { SplitReturnsProps } from './split-returns.props';

const t = ((key: string) => key) as unknown as TFunction;

const setup = (overrides: Partial<SplitReturnsProps> = {}) =>
  render(
    <SplitReturns
      visible
      returns={[{ id: 1, holdingId: null, amount: '' }]}
      buildOptions={() => []}
      onSelectHolding={jest.fn()}
      onCreateHolding={jest.fn()}
      onChangeAmount={jest.fn()}
      onRemove={jest.fn()}
      onAdd={jest.fn()}
      suffix="₴"
      selectHoldingPlaceholder="Select holding"
      t={t}
      {...overrides}
    />,
  );

describe('SplitReturns', () => {
  it('marks the holding and the amount of every row required by default', async () => {
    const { getAllByText } = await setup();

    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('marks neither required where the entry does not ask for them (a template)', async () => {
    const { queryAllByText } = await setup({ required: false });

    expect(queryAllByText('*', { includeHiddenElements: true })).toHaveLength(0);
  });
});

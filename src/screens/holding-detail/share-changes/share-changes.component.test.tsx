import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import GestureRootWrapper from '../../../test-support/gesture-root-wrapper';

import ShareChanges from './share-changes.component';

const firstDay = Date.UTC(2024, 0, 1);
const changeDay = Date.UTC(2025, 5, 1);

const property = (metadata: Record<string, unknown>) => ({
  type: 'property_item' as const,
  metadata: {
    category: 'real_estate',
    lots: [{ day: firstDay, quantityDelta: '1', costMinorUnits: 100_000 }],
    ...metadata,
  },
});

const renderList = (holding: ReturnType<typeof property> | undefined) =>
  render(<ShareChanges holding={holding} onEdit={jest.fn()} onDelete={jest.fn()} />, {
    wrapper: GestureRootWrapper,
  });

describe('ShareChanges', () => {
  it('renders nothing without a stored change', async () => {
    const { queryByText } = await renderList(property({}));

    expect(queryByText('Share Changes')).toBeNull();
  });

  it('renders nothing before the holding loads', async () => {
    const { queryByText } = await renderList(undefined);

    expect(queryByText('Share Changes')).toBeNull();
  });

  it('shows each change as its day and its share, newest first', async () => {
    const { getByText, getAllByTestId } = await renderList(
      property({
        ownership: [
          { day: firstDay, numerator: 1, denominator: 2 },
          { day: changeDay, numerator: 1, denominator: 4 },
        ],
        ownershipInput: 'percent',
      }),
    );
    const rows = getAllByTestId('share-change-row');

    expect(getByText('Share Changes')).toBeTruthy();
    expect(rows[0]).toHaveTextContent('01.06.202525%');
    expect(rows[1]).toHaveTextContent('01.01.202450%');
  });
});

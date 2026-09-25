const mockUpdateWithBalanceDelta = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    updateWithBalanceDelta: (...args: unknown[]) => mockUpdateWithBalanceDelta(...args),
  },
}));

import type { EditContext } from '../holding-type-form';

import { saveMetadataEdit } from './save-metadata-edit';

const baseContext = (): EditContext => ({
  holdingId: 'h-1',
  name: 'My deposit',
  color: '#FF0000',
  currency: 'UAH',
  isSynced: false,
  editingHolding: undefined,
  book: new Map(),
});

describe('saveMetadataEdit', () => {
  it('writes the name, color and metadata through updateWithBalanceDelta, never the balance', async () => {
    const metadata = { annualRatePct: 12 };

    await saveMetadataEdit(baseContext(), metadata);

    expect(mockUpdateWithBalanceDelta).toHaveBeenCalledWith(
      'h-1',
      { name: 'My deposit', color: '#FF0000', metadata },
      expect.any(Number),
    );
  });

  it('passes through an undefined metadata unchanged (an empty contributions list, T28)', async () => {
    await saveMetadataEdit(baseContext(), undefined);

    expect(mockUpdateWithBalanceDelta).toHaveBeenCalledWith(
      'h-1',
      { name: 'My deposit', color: '#FF0000', metadata: undefined },
      expect.any(Number),
    );
  });
});

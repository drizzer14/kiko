import { i18n } from '@kiko/i18n/init';
import { act, renderHook } from '@testing-library/react-native';

import { useViewActions } from './use-view-actions';

const mockOpenInPane = jest.fn();
jest.mock('@kiko/navigation/pane-stack', () => ({
  useOpenInPane: () => mockOpenInPane,
}));

const CARD = { id: 'card', accountId: 'bank', name: 'Everyday card' };
const LOAN = { id: 'loan', accountId: 'debts', name: 'Car loan' };
const BANK = { id: 'bank', name: 'Mono', kind: 'bank', archivedAt: null } as const;
const DEBTS = { id: 'debts', name: 'Loans', kind: 'debt', archivedAt: null } as const;

const viewActionsOf = async (rowHoldingId: string, holdingId = 'card') => {
  const { result } = await renderHook(() =>
    useViewActions({ holdingId, holdings: [CARD, LOAN], accounts: [BANK, DEBTS] }),
  );

  return result.current(rowHoldingId);
};

describe('useViewActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  describe('a row on the page’s own holding', () => {
    it('offers View account only, opening the holding’s account page', async () => {
      const { onViewAccount, onViewHolding } = await viewActionsOf('card');

      expect(onViewHolding).toBeUndefined();

      onViewAccount?.();

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'bank',
        name: 'Mono',
        kind: 'bank',
      });
    });
  });

  describe('a row on another holding (a loan’s linked payment)', () => {
    it('opens the payer holding from View holding', async () => {
      const { onViewHolding } = await viewActionsOf('card', 'loan');

      onViewHolding?.();

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
        holdingId: 'card',
        name: 'Everyday card',
      });
    });

    it('opens the payer’s account, not the loan’s, from View account', async () => {
      const { onViewAccount } = await viewActionsOf('card', 'loan');

      onViewAccount?.();

      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'bank',
        name: 'Mono',
        kind: 'bank',
      });
    });
  });

  // The stored name is an English sentinel; the page is titled in the active language.
  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    it('titles an implicit account’s page by its localized name', async () => {
      const { onViewAccount } = await viewActionsOf('loan');

      onViewAccount?.();

      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'debts',
        name: 'Кредити',
        kind: 'debt',
      });
    });
  });

  it('offers nothing for a row whose holding is not known', async () => {
    expect(await viewActionsOf('gone', 'card')).toEqual({
      onViewAccount: undefined,
      onViewHolding: undefined,
    });
  });

  it('offers no View account while its account is not loaded, yet still View holding', async () => {
    const { result } = await renderHook(() =>
      useViewActions({ holdingId: 'loan', holdings: [CARD, LOAN], accounts: [DEBTS] }),
    );
    const { onViewAccount, onViewHolding } = result.current('card');

    expect(onViewAccount).toBeUndefined();
    expect(onViewHolding).toBeDefined();
  });
});

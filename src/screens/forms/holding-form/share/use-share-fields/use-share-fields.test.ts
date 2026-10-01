import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { dayKeyOf, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useShareFields } from './use-share-fields';

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { updateWithBalanceDelta: jest.fn().mockResolvedValue(undefined) },
}));

const mockHasEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key', () => ({
  hasEodhdKey: () => mockHasEodhdKey(),
}));

const updateMock = holdingsRepo.updateWithBalanceDelta as jest.Mock;

const purchaseDay = new Date(2026, 8, 15).getTime();

type Params = Parameters<typeof useShareFields>[0];

const renderFields = (overrides: Partial<Params> = {}) =>
  renderHook(() => useShareFields({ type: 'share', isEdit: false, currency: 'USD', ...overrides }));

type Rendered = Awaited<ReturnType<typeof renderFields>>;

const fillFirstLot = async (rendered: Rendered, quantity: string, cost: string) => {
  await act(async () => {
    rendered.result.current.setQuantity(quantity);
    rendered.result.current.setCost(cost);
    rendered.result.current.setPurchaseDate(purchaseDay);
  });
};

const storedShare = (metadata: Record<string, unknown>) =>
  ({
    id: 'share-1',
    type: 'share',
    currency: 'GBP',
    metadata: {
      lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
      ...metadata,
    },
  }) as unknown as HoldingRow;

const editContext = {
  holdingId: 'share-1',
  name: 'Vodafone',
  color: null,
  currency: 'GBP' as const,
  isSynced: false,
  editingHolding: undefined,
  book: EMPTY_PRICE_BOOK,
};

beforeEach(() => {
  mockHasEodhdKey.mockReset();
  mockHasEodhdKey.mockResolvedValue(false);
  updateMock.mockClear();
});

describe('useShareFields defaults and order', () => {
  it('starts in manual mode with no saved key, with the purchase date set to today', async () => {
    const { result } = await renderFields();

    await waitFor(() => expect(mockHasEodhdKey).toHaveBeenCalled());
    expect(result.current.quoteSource).toBe('manual');
    expect(dayKeyOf(result.current.purchaseDate)).toBe(dayKeyOf(Date.now()));
  });

  it('starts in EODHD mode once a saved key is found', async () => {
    mockHasEodhdKey.mockResolvedValue(true);

    const { result } = await renderFields();

    await waitFor(() => expect(result.current.quoteSource).toBe('eodhd'));
  });

  it('keeps the price source the user picked before the saved key is found', async () => {
    let resolveKey: (isSaved: boolean) => void = () => undefined;
    mockHasEodhdKey.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveKey = resolve;
      }),
    );

    const { result } = await renderFields();

    await act(async () => {
      result.current.setQuoteSource('manual');
    });
    await act(async () => {
      resolveKey(true);
    });

    expect(result.current.hasEodhdKey).toBe(true);
    expect(result.current.quoteSource).toBe('manual');
  });

  it('orders scrollTargets ticker, ISIN, quantity, cost', async () => {
    const { result } = await renderFields();
    const { refs } = result.current;

    expect(result.current.scrollTargets.map((target) => target.ref)).toEqual([
      refs.tickerFieldRef,
      refs.isinFieldRef,
      refs.quantityFieldRef,
      refs.costFieldRef,
    ]);
  });
});

describe('useShareFields createPayload', () => {
  it('writes a manual share with one lot and a first price equal to cost per share', async () => {
    const rendered = await renderFields();

    await act(async () => {
      rendered.result.current.setQuoteSource('manual');
    });
    await fillFirstLot(rendered, '3', '1 000');

    expect(rendered.result.current.createPayload()).toEqual({
      metadata: {
        quoteSource: 'manual',
        lots: [{ day: dayKeyOf(purchaseDay), quantityDelta: '3', costMinorUnits: 100_000 }],
      },
      firstPricePoint: { day: dayKeyOf(purchaseDay), price: '333.33333333' },
    });
  });

  it('writes a whole first price with no trailing zeros', async () => {
    const rendered = await renderFields();

    await act(async () => {
      rendered.result.current.setQuoteSource('manual');
    });
    await fillFirstLot(rendered, '4', '1000');

    expect(rendered.result.current.createPayload().firstPricePoint?.price).toBe('250');
  });

  it('writes an EODHD share with its symbol and ISIN, and no price point', async () => {
    const rendered = await renderFields();

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.setTicker(' aapl.us ');
      rendered.result.current.setIsin('us0378331005');
    });
    await fillFirstLot(rendered, '2.5', '800');

    expect(rendered.result.current.createPayload()).toEqual({
      metadata: {
        quoteSource: 'eodhd',
        symbol: 'AAPL.US',
        isin: 'US0378331005',
        lots: [{ day: dayKeyOf(purchaseDay), quantityDelta: '2.5', costMinorUnits: 80_000 }],
      },
    });
  });

  it('drops a ticker typed in EODHD mode once the share is switched to manual', async () => {
    const rendered = await renderFields();

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.setTicker('AAPL.US');
    });
    await act(async () => {
      rendered.result.current.setQuoteSource('manual');
    });
    await fillFirstLot(rendered, '1', '100');

    expect(rendered.result.current.createPayload().metadata).not.toHaveProperty('symbol');
  });
});

describe('useShareFields edit', () => {
  it('seeds the price source, ticker, and ISIN from the stored share', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', isin: 'GB00BH4HKS39' }),
      );
    });

    expect(result.current.quoteSource).toBe('eodhd');
    expect(result.current.ticker).toBe('VOD.LSE');
    expect(result.current.isin).toBe('GB00BH4HKS39');
  });

  it('writes the edited fields back with the stored lots and quote currency', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      );
    });
    await act(async () => {
      result.current.setIsin('GB00BH4HKS39');
    });
    await result.current.saveEdit(editContext);

    expect(updateMock).toHaveBeenCalledWith(
      'share-1',
      {
        name: 'Vodafone',
        color: null,
        metadata: {
          quoteSource: 'eodhd',
          symbol: 'VOD.LSE',
          isin: 'GB00BH4HKS39',
          quoteCurrency: 'GBX',
          lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
        },
      },
      expect.any(Number),
    );
  });

  it('drops the stored quote currency once the ticker changes', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      );
    });
    await act(async () => {
      result.current.setTicker('BP.LSE');
    });
    await result.current.saveEdit(editContext);

    expect(updateMock.mock.calls[0][1].metadata).toEqual({
      quoteSource: 'eodhd',
      symbol: 'BP.LSE',
      lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
    });
  });

  it('keeps a stored manual source once a saved key is found', async () => {
    mockHasEodhdKey.mockResolvedValue(true);

    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'manual' }));
    });

    await waitFor(() => expect(result.current.hasEodhdKey).toBe(true));
    expect(result.current.quoteSource).toBe('manual');
  });

  it('keeps a stored EODHD source with no saved key', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE' }));
    });

    await waitFor(() => expect(mockHasEodhdKey).toHaveBeenCalled());
    expect(result.current.quoteSource).toBe('eodhd');
  });

  // The price refresh resolves a missing unit again, so the form never has
  // to guess the new listing's unit.
  it('keeps the stored quote currency for the same ticker typed in another case', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      );
    });
    await act(async () => {
      result.current.setTicker(' vod.lse ');
    });
    await result.current.saveEdit(editContext);

    expect(updateMock.mock.calls[0][1].metadata).toHaveProperty('quoteCurrency', 'GBX');
  });

  it('never blocks an edit on the first-lot fields', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'manual' }));
    });

    expect(result.current.isValid).toBe(true);
  });
});

describe('useShareFields saved EODHD key', () => {
  it('reports a saved key', async () => {
    mockHasEodhdKey.mockResolvedValue(true);

    const { result } = await renderFields();

    await waitFor(() => expect(result.current.hasEodhdKey).toBe(true));
  });

  it('reports no key when the Keychain read fails', async () => {
    mockHasEodhdKey.mockRejectedValue(new Error('keychain'));

    const { result } = await renderFields();

    await waitFor(() => expect(mockHasEodhdKey).toHaveBeenCalled());
    expect(result.current.hasEodhdKey).toBe(false);
  });

  it('never reads the Keychain while another type is selected', async () => {
    await renderFields({ type: 'metal' });

    expect(mockHasEodhdKey).not.toHaveBeenCalled();
  });
});

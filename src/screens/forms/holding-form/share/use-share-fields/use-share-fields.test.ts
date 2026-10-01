import {
  dayKeyOf,
  buildPriceBook,
  type PriceBook,
  EMPTY_PRICE_BOOK,
} from '@kiko/prices/price-book';
import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { shareInstrument } from '@kiko/prices/instrument';
import { fiatCurrencyOptions } from '@kiko/currency/currency';
import type { ShareListing } from '@kiko/prices/share-search';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useShareFields } from './use-share-fields';

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { updateWithManualPricePoint: jest.fn().mockResolvedValue(undefined) },
}));

const mockHasEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key', () => ({
  hasEodhdKey: () => mockHasEodhdKey(),
}));

const mockSearchShares = jest.fn();
jest.mock('@kiko/prices/share-search', () => ({
  searchShares: (...args: unknown[]) => mockSearchShares(...args),
}));

const updateMock = holdingsRepo.updateWithManualPricePoint as jest.Mock;

const purchaseDay = new Date(2026, 8, 15).getTime();
const lastDay = new Date(2026, 8, 25).getTime();

type Params = Parameters<typeof useShareFields>[0];

const renderFields = (overrides: Partial<Params> = {}) =>
  renderHook(() =>
    useShareFields({
      type: 'share',
      isEdit: false,
      currency: 'USD',
      name: '',
      setName: jest.fn(),
      setCurrency: jest.fn(),
      ...overrides,
    }),
  );

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
      null,
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

  describe('switched from EODHD to manual', () => {
    const switchToManual = async (book: PriceBook) => {
      const { result } = await renderFields({ isEdit: true });

      await act(async () => {
        result.current.seed(
          storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
        );
      });
      await act(async () => {
        result.current.setQuoteSource('manual');
      });
      await result.current.saveEdit({ ...editContext, book });
    };

    const sharePoint = (day: number, price: string) => ({
      instrument: shareInstrument('VOD.LSE'),
      day,
      price,
      currency: 'GBP' as const,
      source: 'eodhd' as const,
    });

    it('carries the latest EODHD price over to its own series, in the same write', async () => {
      await switchToManual(
        buildPriceBook([sharePoint(purchaseDay, '1.10'), sharePoint(lastDay, '1.2345')]),
      );

      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith(
        'share-1',
        {
          name: 'Vodafone',
          color: null,
          metadata: {
            quoteSource: 'manual',
            lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
          },
        },
        { day: lastDay, price: '1.2345', currency: 'GBP' },
      );
    });

    it('writes no price when the symbol has none yet', async () => {
      await switchToManual(EMPTY_PRICE_BOOK);

      expect(updateMock.mock.calls[0][2]).toBeNull();
    });
  });

  it('writes no price when a manual share stays manual', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'manual', symbol: 'VOD.LSE' }));
    });
    await result.current.saveEdit({
      ...editContext,
      book: buildPriceBook([
        {
          instrument: shareInstrument('VOD.LSE'),
          day: lastDay,
          price: '1.2345',
          currency: 'GBP',
          source: 'eodhd',
        },
      ]),
    });

    expect(updateMock.mock.calls[0][2]).toBeNull();
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

describe('useShareFields search', () => {
  const vodafone: ShareListing = {
    symbol: 'VOD.LSE',
    name: 'Vodafone Group PLC',
    isin: 'GB00BH4HKS39',
    currency: 'GBP',
    quoteCurrency: 'GBX',
  };

  beforeEach(() => {
    mockSearchShares.mockReset();
    mockSearchShares.mockResolvedValue({ status: 'ok', listings: [] });
  });

  it('searches the currencies a new share may take', async () => {
    const { result } = await renderFields();

    await result.current.search('VOD');

    expect(mockSearchShares).toHaveBeenCalledWith('VOD', fiatCurrencyOptions);
  });

  it('searches only the currency an edited share already has', async () => {
    const { result } = await renderFields({ isEdit: true, currency: 'GBP' });

    await result.current.search('VOD');

    expect(mockSearchShares).toHaveBeenCalledWith('VOD', ['GBP']);
  });

  it('fills the ticker, ISIN, name, and currency from the picked listing', async () => {
    const setName = jest.fn();
    const setCurrency = jest.fn();
    const { result } = await renderFields({ setName, setCurrency });

    await act(async () => {
      result.current.pickListing(vodafone);
    });

    expect(result.current.ticker).toBe('VOD.LSE');
    expect(result.current.isin).toBe('GB00BH4HKS39');
    expect(setName).toHaveBeenCalledWith('Vodafone Group PLC');
    expect(setCurrency).toHaveBeenCalledWith('GBP');
  });

  it('writes the picked listing with its price unit', async () => {
    mockHasEodhdKey.mockResolvedValue(true);
    const rendered = await renderFields();

    await waitFor(() => expect(rendered.result.current.quoteSource).toBe('eodhd'));
    await act(async () => {
      rendered.result.current.pickListing(vodafone);
    });
    await fillFirstLot(rendered, '10', '120');

    expect(rendered.result.current.createPayload().metadata).toEqual({
      quoteSource: 'eodhd',
      symbol: 'VOD.LSE',
      isin: 'GB00BH4HKS39',
      quoteCurrency: 'GBX',
      lots: [{ day: dayKeyOf(purchaseDay), quantityDelta: '10', costMinorUnits: 12_000 }],
    });
  });

  it('drops the picked price unit once the ticker is typed over', async () => {
    mockHasEodhdKey.mockResolvedValue(true);
    const rendered = await renderFields();

    await waitFor(() => expect(rendered.result.current.quoteSource).toBe('eodhd'));
    await act(async () => {
      rendered.result.current.pickListing(vodafone);
    });
    await act(async () => {
      rendered.result.current.setTicker('BP.LSE');
    });
    await fillFirstLot(rendered, '1', '100');

    expect(rendered.result.current.createPayload().metadata).not.toHaveProperty('quoteCurrency');
  });

  it('keeps a name the user typed', async () => {
    const setName = jest.fn();
    const { result } = await renderFields({ name: 'My phone shares', setName });

    await act(async () => {
      result.current.pickListing(vodafone);
    });

    expect(setName).not.toHaveBeenCalled();
  });

  it('replaces the name its last pick filled', async () => {
    const setName = jest.fn();
    const { result, rerender } = await renderHook(
      ({ name }: { name: string }) =>
        useShareFields({
          type: 'share',
          isEdit: false,
          currency: 'USD',
          name,
          setName,
          setCurrency: jest.fn(),
        }),
      { initialProps: { name: '' } },
    );

    await act(async () => {
      result.current.pickListing(vodafone);
    });
    await rerender({ name: 'Vodafone Group PLC' });
    await act(async () => {
      result.current.pickListing({ ...vodafone, symbol: 'BP.LSE', name: 'BP PLC' });
    });

    expect(setName.mock.calls).toEqual([['Vodafone Group PLC'], ['BP PLC']]);
  });

  it('keeps the typed ISIN when the listing has none', async () => {
    const { result } = await renderFields();
    const { isin: _isin, ...withoutIsin } = vodafone;

    await act(async () => {
      result.current.setIsin('GB00BH4HKS39');
    });
    await act(async () => {
      result.current.pickListing(withoutIsin);
    });

    expect(result.current.isin).toBe('GB00BH4HKS39');
  });

  it('saves an edited share with the price unit of the listing picked for it', async () => {
    const { result } = await renderFields({ isEdit: true, currency: 'GBP' });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.US' }));
    });
    await act(async () => {
      result.current.pickListing(vodafone);
    });
    await result.current.saveEdit(editContext);

    expect(updateMock.mock.calls[0][1].metadata).toMatchObject({
      symbol: 'VOD.LSE',
      quoteCurrency: 'GBX',
    });
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

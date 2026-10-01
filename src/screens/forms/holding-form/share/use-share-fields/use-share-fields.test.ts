import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { fiatCurrencyOptions } from '@kiko/currency/currency';
import type { ShareListing } from '@kiko/prices/share-search';
import { dayKeyOf, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useShareFields } from './use-share-fields';

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { updateShareFromStored: jest.fn().mockResolvedValue(undefined) },
}));

const mockHasEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key', () => ({
  hasEodhdKey: () => mockHasEodhdKey(),
}));

const mockSearchShares = jest.fn();
const mockLookupShareUnit = jest.fn();
jest.mock('@kiko/prices/share-search', () => ({
  ...jest.requireActual('@kiko/prices/share-search'),
  searchShares: (...args: unknown[]) => mockSearchShares(...args),
  lookupShareUnit: (...args: unknown[]) => mockLookupShareUnit(...args),
}));

const updateMock = holdingsRepo.updateShareFromStored as jest.Mock;

const purchaseDay = new Date(2026, 8, 15).getTime();
const lastDay = new Date(2026, 8, 25).getTime();

type Params = Parameters<typeof useShareFields>[0];

const currencyFieldRef = { current: null };

const renderFields = (overrides: Partial<Params> = {}) =>
  renderHook(() =>
    useShareFields({
      type: 'share',
      isEdit: false,
      currency: 'USD',
      name: '',
      setName: jest.fn(),
      setCurrency: jest.fn(),
      currencyFieldRef,
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

// The edit builds its metadata from the row stored at the time of the write.
const writtenMetadata = (stored: HoldingRow = storedShare({})): unknown =>
  updateMock.mock.calls[0][2](stored.metadata);

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

  it('orders scrollTargets currency, ticker, ISIN, quantity, cost', async () => {
    const { result } = await renderFields();
    const { refs } = result.current;

    expect(result.current.scrollTargets.map((target) => target.ref)).toEqual([
      currencyFieldRef,
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
      { name: 'Vodafone', color: null },
      expect.any(Function),
    );
    expect(
      writtenMetadata(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      ),
    ).toEqual({
      quoteSource: 'eodhd',
      symbol: 'VOD.LSE',
      isin: 'GB00BH4HKS39',
      quoteCurrency: 'GBX',
      lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
    });
  });

  it('keeps a quote currency and lots stored after the form opened', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE' }));
    });
    await result.current.saveEdit(editContext);

    const laterLots = [
      { day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 },
      { day: lastDay, quantityDelta: '5', costMinorUnits: 7_000 },
    ];

    expect(
      writtenMetadata(
        storedShare({
          quoteSource: 'eodhd',
          symbol: 'VOD.LSE',
          quoteCurrency: 'GBX',
          lots: laterLots,
        }),
      ),
    ).toEqual({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX', lots: laterLots });
  });

  // A stored share that no longer parses (an unknown source) still has its
  // lots, and the edit that repairs it must keep them.
  it('keeps readable stored lots when the rest of the stored share does not parse', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE' }));
    });
    await result.current.saveEdit(editContext);

    expect(writtenMetadata(storedShare({ quoteSource: 'yahoo' }))).toEqual({
      quoteSource: 'eodhd',
      symbol: 'VOD.LSE',
      lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
    });
  });

  // Writing over a list with one unreadable entry would drop every readable
  // lot with it, so the build throws and the write rolls back.
  it('refuses to write when one stored lot is unreadable', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE' }));
    });
    await result.current.saveEdit(editContext);

    expect(() =>
      writtenMetadata(
        storedShare({
          quoteSource: 'eodhd',
          symbol: 'VOD.LSE',
          lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }, { day: 'x' }],
        }),
      ),
    ).toThrow('shareEdit: stored lots are unreadable');
  });

  it('writes no lots for a stored share with no lots key', async () => {
    const { result } = await renderFields({ isEdit: true });

    await act(async () => {
      result.current.seed(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE' }));
    });
    await result.current.saveEdit(editContext);

    expect(writtenMetadata(storedShare({ quoteSource: 'yahoo', lots: undefined }))).toEqual({
      quoteSource: 'eodhd',
      symbol: 'VOD.LSE',
      lots: [],
    });
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

    expect(
      writtenMetadata(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      ),
    ).toEqual({
      quoteSource: 'eodhd',
      symbol: 'BP.LSE',
      lots: [{ day: purchaseDay, quantityDelta: '10', costMinorUnits: 12_000 }],
    });
  });

  // The repo carries the symbol's closes over once it sees the switch.
  it('writes a manual share with no symbol or quote currency', async () => {
    const { result } = await renderFields({ isEdit: true });
    const stored = storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' });

    await act(async () => {
      result.current.seed(stored);
    });
    await act(async () => {
      result.current.setQuoteSource('manual');
    });
    await result.current.saveEdit(editContext);

    expect(writtenMetadata(stored)).toEqual({
      quoteSource: 'manual',
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

    expect(
      writtenMetadata(
        storedShare({ quoteSource: 'eodhd', symbol: 'VOD.LSE', quoteCurrency: 'GBX' }),
      ),
    ).toHaveProperty('quoteCurrency', 'GBX');
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
          currencyFieldRef,
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

  it('keeps a typed ISIN when the listing has another one', async () => {
    const { result } = await renderFields();

    await act(async () => {
      result.current.setIsin('US0378331005');
    });
    await act(async () => {
      result.current.pickListing(vodafone);
    });

    expect(result.current.isin).toBe('US0378331005');
  });

  it('clears the ISIN its last pick filled when the next listing has none', async () => {
    const { result } = await renderFields();
    const { isin: _isin, ...withoutIsin } = vodafone;

    await act(async () => {
      result.current.pickListing({ ...vodafone, symbol: 'AAPL.US', isin: 'US0378331005' });
    });
    await act(async () => {
      result.current.pickListing({ ...withoutIsin, symbol: '0LQQ.LSE' });
    });

    expect(result.current.isin).toBe('');
  });

  it('replaces the ISIN its last pick filled with the next listing’s', async () => {
    const { result } = await renderFields();

    await act(async () => {
      result.current.pickListing({ ...vodafone, symbol: 'AAPL.US', isin: 'US0378331005' });
    });
    await act(async () => {
      result.current.pickListing(vodafone);
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

    expect(writtenMetadata(storedShare({ quoteSource: 'eodhd', symbol: 'VOD.US' }))).toMatchObject({
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

describe('useShareFields currency against the listing', () => {
  const vodafone: ShareListing = {
    symbol: 'VOD.LSE',
    name: 'Vodafone Group PLC',
    isin: 'GB00BH4HKS39',
    currency: 'GBP',
    quoteCurrency: 'GBX',
  };

  const typeTicker = async (rendered: Rendered, ticker: string) => {
    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.setTicker(ticker);
    });
    await fillFirstLot(rendered, '3', '900');
  };

  const firstLot = { day: dayKeyOf(purchaseDay), quantityDelta: '3', costMinorUnits: 90_000 };

  beforeEach(() => {
    mockLookupShareUnit.mockReset();
  });

  it('blocks Save on the Currency field for a picked listing held in another currency', async () => {
    const rendered = await renderFields({ currency: 'USD' });

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.pickListing(vodafone);
    });
    await fillFirstLot(rendered, '3', '900');

    expect(rendered.result.current.fieldErrors.currencyError).toBe(
      'forms.holding.shareCurrencyMismatchError',
    );
    expect(rendered.result.current.listingCurrency).toBe('GBP');
    expect(rendered.result.current.isValid).toBe(false);
    expect(rendered.result.current.scrollTargets[0]).toMatchObject({
      invalid: true,
      ref: currencyFieldRef,
    });
  });

  it('accepts a picked pence listing held in pounds', async () => {
    const rendered = await renderFields({ currency: 'GBP' });

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.pickListing(vodafone);
    });

    expect(rendered.result.current.fieldErrors.currencyError).toBeNull();
  });

  it('never checks the currency of a manual share', async () => {
    const rendered = await renderFields({ currency: 'USD' });

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.pickListing(vodafone);
    });
    await act(async () => {
      rendered.result.current.setQuoteSource('manual');
    });

    expect(rendered.result.current.fieldErrors.currencyError).toBeNull();
  });

  it('saves a manual share with no lookup', async () => {
    const rendered = await renderFields();

    await act(async () => {
      rendered.result.current.setQuoteSource('manual');
    });
    await fillFirstLot(rendered, '3', '900');

    await expect(rendered.result.current.checkCreate?.()).resolves.toMatchObject({
      kind: 'save',
      payload: { metadata: { quoteSource: 'manual' } },
    });
    expect(mockLookupShareUnit).not.toHaveBeenCalled();
  });

  it('saves a picked listing with its own unit and no lookup', async () => {
    const rendered = await renderFields({ currency: 'GBP' });

    await act(async () => {
      rendered.result.current.setQuoteSource('eodhd');
      rendered.result.current.pickListing(vodafone);
    });
    await fillFirstLot(rendered, '3', '900');

    await expect(rendered.result.current.checkCreate?.()).resolves.toMatchObject({
      kind: 'save',
      payload: { metadata: { symbol: 'VOD.LSE', quoteCurrency: 'GBX' } },
    });
    expect(mockLookupShareUnit).not.toHaveBeenCalled();
  });

  it('looks a hand-typed ticker up once and saves the unit it found', async () => {
    mockLookupShareUnit.mockResolvedValue({ status: 'ok', unit: 'USD' });
    const rendered = await renderFields({ currency: 'USD' });

    await typeTicker(rendered, ' aapl.us ');

    await expect(rendered.result.current.checkCreate?.()).resolves.toEqual({
      kind: 'save',
      payload: {
        metadata: {
          quoteSource: 'eodhd',
          symbol: 'AAPL.US',
          quoteCurrency: 'USD',
          lots: [firstLot],
        },
      },
    });
    expect(mockLookupShareUnit.mock.calls).toEqual([['AAPL.US']]);
  });

  it('blocks a hand-typed ticker priced in another currency on the Currency field', async () => {
    mockLookupShareUnit.mockResolvedValue({ status: 'ok', unit: 'USD' });
    const rendered = await renderFields({ currency: 'UAH' });

    await typeTicker(rendered, 'AAPL.US');

    const checks: unknown[] = [];

    await act(async () => {
      checks.push(await rendered.result.current.checkCreate?.());
    });

    expect(checks).toEqual([
      expect.objectContaining({
        kind: 'blocked',
        target: expect.objectContaining({ ref: currencyFieldRef }),
      }),
    ]);
    expect(rendered.result.current.fieldErrors.currencyError).toBe(
      'forms.holding.shareCurrencyMismatchError',
    );
    expect(rendered.result.current.listingCurrency).toBe('USD');
  });

  it('never looks the same ticker up twice', async () => {
    mockLookupShareUnit.mockResolvedValue({ status: 'ok', unit: 'USD' });
    const rendered = await renderFields({ currency: 'UAH' });

    await typeTicker(rendered, 'AAPL.US');
    await act(async () => {
      await rendered.result.current.checkCreate?.();
    });

    expect(rendered.result.current.isValid).toBe(false);

    await act(async () => {
      rendered.result.current.setTicker('MSFT.US');
    });

    expect(rendered.result.current.fieldErrors.currencyError).toBeNull();

    await act(async () => {
      rendered.result.current.setTicker('AAPL.US');
    });

    expect(rendered.result.current.fieldErrors.currencyError).toBe(
      'forms.holding.shareCurrencyMismatchError',
    );
    expect(mockLookupShareUnit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no key', { status: 'noKey' }],
    ['a rejected key', { status: 'keyRejected' }],
    ['no calls left', { status: 'quotaExhausted' }],
    ['no answer', { status: 'failed' }],
    ['no listing of that symbol', { status: 'notFound' }],
  ])('saves a hand-typed ticker as before with %s', async (_reason, lookup) => {
    mockLookupShareUnit.mockResolvedValue(lookup);
    const rendered = await renderFields({ currency: 'UAH' });

    await typeTicker(rendered, 'AAPL.US');

    await expect(rendered.result.current.checkCreate?.()).resolves.toEqual({
      kind: 'save',
      payload: { metadata: { quoteSource: 'eodhd', symbol: 'AAPL.US', lots: [firstLot] } },
    });
  });

  it('saves as before when the lookup itself fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockLookupShareUnit.mockRejectedValue(new Error('keychain'));
    const rendered = await renderFields({ currency: 'UAH' });

    await typeTicker(rendered, 'AAPL.US');

    await expect(rendered.result.current.checkCreate?.()).resolves.toMatchObject({
      kind: 'save',
    });
    warn.mockRestore();
  });
});

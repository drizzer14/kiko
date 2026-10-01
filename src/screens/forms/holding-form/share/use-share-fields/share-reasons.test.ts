import { shareFieldErrors, shareReasonKey } from './share-reasons';

const baseParams = () => ({
  isEdit: false,
  quoteSource: 'eodhd' as const,
  ticker: 'AAPL.US',
  isin: '',
  quantity: '3',
  cost: '900',
});

describe('shareFieldErrors — ticker', () => {
  it('rejects a blank ticker in EODHD mode', () => {
    expect(shareFieldErrors({ ...baseParams(), ticker: '  ' }).tickerError).toBe(
      'forms.holding.shareTickerError',
    );
  });

  it.each(['AAPL', 'AAPL.', '.US', 'BRK.B.US', 'AA PL.US'])(
    'rejects %p, which names no single exchange, in EODHD mode',
    (ticker) => {
      expect(shareFieldErrors({ ...baseParams(), ticker }).tickerError).toBe(
        'forms.holding.shareTickerError',
      );
    },
  );

  it('accepts a CODE.EXCHANGE ticker, trimmed, in any case', () => {
    expect(shareFieldErrors({ ...baseParams(), ticker: ' vod.lse ' }).tickerError).toBeNull();
  });

  it('never asks for a ticker in manual mode', () => {
    expect(
      shareFieldErrors({ ...baseParams(), quoteSource: 'manual', ticker: '' }).tickerError,
    ).toBeNull();
  });

  it('applies in edit mode too', () => {
    expect(shareFieldErrors({ ...baseParams(), isEdit: true, ticker: '' }).tickerError).toBe(
      'forms.holding.shareTickerError',
    );
  });
});

describe('shareFieldErrors — ISIN', () => {
  it('accepts a blank ISIN, which is optional', () => {
    expect(shareFieldErrors(baseParams()).isinError).toBeNull();
  });

  it('accepts a valid ISIN, trimmed and uppercased', () => {
    expect(shareFieldErrors({ ...baseParams(), isin: ' us0378331005 ' }).isinError).toBeNull();
  });

  it('rejects an ISIN with a wrong check digit', () => {
    expect(shareFieldErrors({ ...baseParams(), isin: 'US0378331006' }).isinError).toBe(
      'forms.holding.isinCheckDigitError',
    );
  });

  it('rejects an ISIN with a wrong shape', () => {
    expect(shareFieldErrors({ ...baseParams(), isin: 'AAPL' }).isinError).toBe(
      'forms.holding.isinFormatError',
    );
  });
});

describe('shareFieldErrors — first lot', () => {
  it('rejects a missing or zero quantity on create', () => {
    expect(shareFieldErrors({ ...baseParams(), quantity: '' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
    expect(shareFieldErrors({ ...baseParams(), quantity: '0' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
  });

  it('accepts a fractional quantity', () => {
    expect(shareFieldErrors({ ...baseParams(), quantity: '0.25' }).quantityError).toBeNull();
  });

  it('rejects a missing total cost on create', () => {
    expect(shareFieldErrors({ ...baseParams(), cost: '' }).costError).toBe(
      'forms.lot.totalCostError',
    );
  });

  it('never checks the first lot on edit', () => {
    const errors = shareFieldErrors({ ...baseParams(), isEdit: true, quantity: '', cost: '' });

    expect(errors.quantityError).toBeNull();
    expect(errors.costError).toBeNull();
  });
});

describe('shareReasonKey', () => {
  it('is null when every field is valid', () => {
    expect(shareReasonKey(baseParams())).toBeNull();
  });

  it('reports the first failing field in form order', () => {
    expect(shareReasonKey({ ...baseParams(), ticker: '', isin: 'AAPL', cost: '' })).toBe(
      'forms.holding.shareTickerError',
    );
    expect(shareReasonKey({ ...baseParams(), isin: 'AAPL', cost: '' })).toBe(
      'forms.holding.isinFormatError',
    );
    expect(shareReasonKey({ ...baseParams(), cost: '' })).toBe('forms.lot.totalCostError');
  });
});

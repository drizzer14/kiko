import '../../i18n';

import { i18n } from '../../i18n';
import { formatDate } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { buildPriceBook, EMPTY_PRICE_BOOK } from '../price-book';

import { priceAsOfCaption } from './price-as-of-caption';

const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    accountId: 'a1',
    type: 'property_item',
    name: 'x',
    currency: 'UAH',
    balanceMinorUnits: 0,
    icon: null,
    color: null,
    bankId: null,
    externalId: null,
    metadata: null,
    sortOrder: 0,
    ...overrides,
  }) as HoldingRow;

describe('priceAsOfCaption', () => {
  it('returns undefined for a non-priced holding type', () => {
    expect(priceAsOfCaption(holding({ type: 'cash' }), EMPTY_PRICE_BOOK, i18n.t)).toBeUndefined();
  });

  it('returns undefined for undefined holding', () => {
    expect(priceAsOfCaption(undefined, EMPTY_PRICE_BOOK, i18n.t)).toBeUndefined();
  });

  it('returns undefined for a priced holding with no stored price point yet', () => {
    expect(
      priceAsOfCaption(holding({ type: 'property_item' }), EMPTY_PRICE_BOOK, i18n.t),
    ).toBeUndefined();
  });

  it('shows "Value as of <date>" for a property holding\'s own holding:<id> instrument', () => {
    const day = Date.UTC(2024, 0, 1);
    const priceBook = buildPriceBook([
      { instrument: 'holding:h1', day, price: '1000.00', currency: 'UAH', source: 'manual' },
    ]);

    expect(priceAsOfCaption(holding({ type: 'property_item' }), priceBook, i18n.t)).toBe(
      i18n.t('holdingDetail.valueAsOf', { date: formatDate(day, { timeZone: 'UTC' }) }),
    );
  });

  // Divergent twins — holding-card's own copy of this helper used to lack
  // this branch entirely, so a metal holding's card never
  // showed ANY caption (its `holding:<id>` instrument never resolves for a
  // metal — the shared `metal:<XAU|...>` instrument does).
  it('shows "Price as of <date>" for a metal holding\'s own SHARED metal:<slug> instrument', () => {
    const day = Date.UTC(2024, 0, 1);
    const priceBook = buildPriceBook([
      { instrument: 'metal:XAU', day, price: '2000.00', currency: 'USD', source: 'manual' },
    ]);
    const metalHolding = holding({
      type: 'metal',
      metadata: { metal: 'XAU', form: 'bar', unit: 'g', purity: '0.9999', lots: [] },
    });

    expect(priceAsOfCaption(metalHolding, priceBook, i18n.t)).toBe(
      i18n.t('holdingDetail.priceAsOf', { date: formatDate(day, { timeZone: 'UTC' }) }),
    );
  });

  it('returns undefined for a metal holding with an invalid/absent MetalMeta', () => {
    const priceBook = buildPriceBook([
      {
        instrument: 'metal:XAU',
        day: Date.UTC(2024, 0, 1),
        price: '2000.00',
        currency: 'USD',
        source: 'manual',
      },
    ]);

    expect(
      priceAsOfCaption(holding({ type: 'metal', metadata: null }), priceBook, i18n.t),
    ).toBeUndefined();
  });
});

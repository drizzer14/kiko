import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';

import type { HoldingRow } from '../../../db/schema';
import '../../../design-system/unistyles';
import { formatDate } from '../../../dates/format';
import { darkTheme } from '../../../design-system/theme';
import { entityIconTileGradient } from '../../../design-system/entity-tint';
import { buildPriceBook, EMPTY_PRICE_BOOK } from '../../../prices/price-book';

import HoldingCard from './holding-card.component';

// A minimal, valuable manual holding. holdingValue takes the default `flat`
// branch for a `card` type, so its value is just the stored balance.
const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Black card',
    type: 'card',
    currency: 'UAH',
    balanceMinorUnits: 100000,
    icon: null,
    metadata: null,
    ...overrides,
  }) as unknown as HoldingRow;

const NOW = Date.UTC(2024, 0, 1);

// Render the card with sensible defaults — a UAH holding on a UAH base with no
// rates — so each test overrides only what it exercises. The base-currency
// caption below the value appears only for a holding in a DIFFERENT currency,
// so these defaults never render it.
const renderCard = (overrides: Partial<ComponentProps<typeof HoldingCard>> = {}) =>
  render(
    <HoldingCard
      holding={holding()}
      now={NOW}
      baseCurrency="UAH"
      rateTable={{}}
      priceBook={EMPTY_PRICE_BOOK}
      onOpen={jest.fn()}
      {...overrides}
    />,
  );

describe('HoldingCard', () => {
  it('renders the holding name and its computed value', async () => {
    const { getByText } = await renderCard();
    expect(getByText('Black card')).toBeTruthy();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('opens the holding detail on a plain tap', async () => {
    const onOpen = jest.fn();
    const { getByText } = await renderCard({ onOpen });
    await fireEvent.press(getByText('Black card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // The squircle-gradient icon tile is the permanent treatment (see
  // `EntityIconTile`): the holding's color drives the icon TILE's gradient
  // fill (never the raw glyph tint, the fixed legible `onAccent` white), and
  // the card itself is a plain neutral surface instead of an entity-colored
  // wash — mirrors accounts.screen.test.tsx's identical pair.
  it('tints the icon glyph with the legible onAccent token, not the raw holding color', async () => {
    const { getByLabelText } = await renderCard({
      holding: holding({ color: darkTheme.colors.entityColors.violet }),
    });

    expect(getByLabelText('Black card icon').props.tintColor).toBe(darkTheme.colors.onAccent);
  });

  it("derives the icon tile's gradient from the holding's stored color", async () => {
    const { getByTestId } = await renderCard({
      holding: holding({ color: darkTheme.colors.entityColors.violet }),
    });

    const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.violet);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it("derives the icon tile's gradient from the type default when the holding has no stored color", async () => {
    const { getByTestId } = await renderCard({ holding: holding({ color: null }) });

    // A `card` holding with no color reads the card type default (white).
    const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.white);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it('leaves the card itself the shared solid surface, not an entity-color wash', async () => {
    const { getByTestId } = await renderCard({
      holding: holding({ color: darkTheme.colors.entityColors.violet }),
    });

    // The color lives on the icon tile only (see the tests above) — the card
    // itself is the shared solid content-layer `Card`: a flat `surface` fill,
    // applied directly to its own node (no separate base/wash sub-layer the
    // way `GlassSurface` used to render, and no colored wash at all).
    const flat = StyleSheet.flatten(getByTestId('holding-card').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  it('draws the shared hairline card border on first render (matches the account card, G2)', async () => {
    const { getByTestId } = await renderCard();

    const cardStyle = StyleSheet.flatten(getByTestId('holding-card').props.style);
    expect(cardStyle.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(cardStyle.borderColor).toBe(darkTheme.colors.border);
  });

  it('renders as a wide row card (no square aspectRatio), mirroring the accounts card', async () => {
    const { getByTestId } = await renderCard();
    // The holding is now a full-width row (icon + name left, value right) in a
    // 1-column list, not a square tile — so the card carries no aspectRatio.
    const cardStyle = StyleSheet.flatten(getByTestId('holding-card').props.style);
    expect(cardStyle.aspectRatio).toBeUndefined();
  });

  // The value's own currency is primary; a holding in a currency other than the
  // base (main) currency shows a smaller converted base-currency value below it,
  // so the user reads both the native figure and its main-currency worth.
  describe('the base-currency caption', () => {
    it('shows the converted main-currency value below a foreign-currency value', async () => {
      const { getByText, getByTestId } = await renderCard({
        holding: holding({ currency: 'USD', balanceMinorUnits: 10000 }),
        baseCurrency: 'UAH',
        rateTable: { 'USD:UAH': 40 },
      });

      // The primary value stays in the holding's own currency.
      expect(getByText('$100.00')).toBeTruthy();
      // The converted caption shows the base-currency worth ($100 × 40), inside
      // its own container.
      expect(getByTestId('holding-card-converted')).toBeTruthy();
      expect(getByText(/4,000\.00 ₴/)).toBeTruthy();
    });

    it('omits the caption when the holding is already in the base currency', async () => {
      const { queryByTestId } = await renderCard({
        holding: holding({ currency: 'UAH' }),
        baseCurrency: 'UAH',
        rateTable: { 'USD:UAH': 40 },
      });

      expect(queryByTestId('holding-card-converted')).toBeNull();
    });

    it('omits the caption when no rate to the base currency is cached', async () => {
      const { queryByTestId } = await renderCard({
        holding: holding({ currency: 'USD', balanceMinorUnits: 10000 }),
        baseCurrency: 'UAH',
        rateTable: {},
      });

      expect(queryByTestId('holding-card-converted')).toBeNull();
    });
  });

  // A priced holding (property_item — isPricedHoldingType) shows the
  // LATEST stored price point's own day beneath its value, so the user sees
  // how current its revaluation is — the same caption holding-detail renders.
  describe('the "Value as of" caption', () => {
    const propertyHolding = holding({
      type: 'property_item',
      metadata: {
        category: 'real_estate',
        lots: [{ day: Date.UTC(2024, 0, 1), quantityDelta: '1', costMinorUnits: 100_000 }],
      },
    });

    it('shows "Value as of <date>" for a priced holding with a stored price point', async () => {
      const day = Date.UTC(2024, 0, 1);
      const priceBook = buildPriceBook([
        { instrument: 'holding:h1', day, price: '1000.00', currency: 'UAH', source: 'manual' },
      ]);

      const { getByText, getByTestId } = await renderCard({
        holding: propertyHolding,
        priceBook,
      });

      expect(getByTestId('holding-card-value-as-of')).toBeTruthy();
      expect(getByText(`Value as of ${formatDate(day, { timeZone: 'UTC' })}`)).toBeTruthy();
    });

    it('omits the caption for a priced holding with no stored price point yet', async () => {
      const { queryByTestId } = await renderCard({
        holding: propertyHolding,
        priceBook: EMPTY_PRICE_BOOK,
      });

      expect(queryByTestId('holding-card-value-as-of')).toBeNull();
    });

    it('omits the caption for a non-priced holding type', async () => {
      const { queryByTestId } = await renderCard();

      expect(queryByTestId('holding-card-value-as-of')).toBeNull();
    });

    // F4 audit 13: divergent twins — this card's own copy of the caption
    // helper used to lack the metal branch entirely, so a metal holding's
    // card showed NO caption at all (its `holding:<id>` instrument never
    // resolves for a metal — only the shared `metal:<slug>` one does). Now
    // shared with holding-detail via `priceAsOfCaption`.
    it('shows "Price as of <date>" for a metal holding, via its own SHARED metal:<slug> instrument', async () => {
      const day = Date.UTC(2024, 0, 1);
      const priceBook = buildPriceBook([
        { instrument: 'metal:XAU', day, price: '2000.00', currency: 'USD', source: 'manual' },
      ]);
      const metalHolding = holding({
        type: 'metal',
        currency: 'USD',
        metadata: { metal: 'XAU', form: 'bar', unit: 'g', purity: '0.9999', lots: [] },
      });

      const { getByText } = await renderCard({ holding: metalHolding, priceBook });

      expect(getByText(`Price as of ${formatDate(day, { timeZone: 'UTC' })}`)).toBeTruthy();
    });
  });
});

import { StyleSheet } from 'react-native';
import type { HoldingRow } from '@kiko/db';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { DAY_MS } from '@kiko/dates';
import { darkTheme } from '@kiko/design-system/theme';
import { EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { entityIconTileGradient } from '@kiko/design-system/entity-tint';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

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

  it('renders a row of a removed type with the generic holding glyph', async () => {
    const { getByText, getByLabelText } = await renderCard({
      holding: holding({ type: 'share' as unknown as HoldingRow['type'] }),
    });

    expect(getByText('Black card')).toBeTruthy();
    expect(getByLabelText('Black card icon').props.name).toBe('list.bullet.rectangle');
  });

  // A long name must wrap, not run past the card edge and push the value out of
  // view. Jest cannot lay out pixels, so this pins the style contract the
  // transaction card wraps with.
  it('wraps a long name beside the icon while the value keeps its own width', async () => {
    const longName = 'Середньострокові облігації UA4000239115 з дуже довгою назвою';
    const { getByText } = await renderCard({ holding: holding({ name: longName }) });
    const title = getByText(longName);
    const titleBox = StyleSheet.flatten(ancestorWithStyle(title, 'flex').props.style);

    expect(title.props.numberOfLines).toBeUndefined();
    expect(titleBox.flex).toBe(1);
    expect(titleBox.flexDirection).toBeUndefined();
    expect(
      StyleSheet.flatten(ancestorWithStyle(getByText(/1,000\.00 ₴/), 'flexShrink').props.style)
        .flexShrink,
    ).toBe(0);
    const leadBox = StyleSheet.flatten(ancestorWithStyle(title, 'alignItems').props.style);
    expect(leadBox.flex).toBe(1);
    // A short name still centers beside the icon tile, as before.
    expect(leadBox.alignItems).toBe('center');
  });

  describe('a shared property', () => {
    const property = (metadata: Record<string, unknown> = {}): HoldingRow =>
      holding({
        name: 'Flat',
        type: 'property_item',
        metadata: {
          category: 'real_estate',
          lots: [{ day: NOW, quantityDelta: '1', costMinorUnits: 300_000_000 }],
          ...metadata,
        },
      });

    it('shows the owned value, then the share of the whole', async () => {
      const { getByText, getByTestId } = await renderCard({
        holding: property({
          ownership: [{ day: NOW, numerator: 1, denominator: 3 }],
          ownershipInput: 'fraction',
        }),
      });

      expect(getByText(/^1,000,000\.00 ₴$/)).toBeTruthy();
      expect(getByTestId('holding-card-whole')).toHaveTextContent('1/3 of 3,000,000.00 ₴');
    });

    it('shows a percent-typed share as its percent', async () => {
      const { getByTestId } = await renderCard({
        holding: property({
          ownership: [{ day: NOW, numerator: 1, denominator: 2 }],
          ownershipInput: 'percent',
        }),
      });

      expect(getByTestId('holding-card-whole')).toHaveTextContent('50% of 3,000,000.00 ₴');
    });

    it('shows the whole value and no share before a future share change', async () => {
      const { getByText, queryByTestId } = await renderCard({
        holding: property({
          ownership: [{ day: NOW + DAY_MS, numerator: 1, denominator: 2 }],
          ownershipInput: 'percent',
        }),
      });

      expect(getByText(/^3,000,000\.00 ₴$/)).toBeTruthy();
      expect(queryByTestId('holding-card-whole')).toBeNull();
    });

    it('shows no second line for a property owned whole', async () => {
      const { getByText, queryByTestId } = await renderCard({ holding: property() });

      expect(getByText(/^3,000,000\.00 ₴$/)).toBeTruthy();
      expect(queryByTestId('holding-card-whole')).toBeNull();
    });
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

  it("shows a property's category glyph when it has no icon of its own", async () => {
    const { getByLabelText } = await renderCard({
      holding: holding({
        name: 'Sedan',
        type: 'property_item',
        metadata: { category: 'vehicle', lots: [] },
      }),
    });

    expect(getByLabelText('Sedan icon').props.name).toBe('car.fill');
  });

  it("shows a loan's kind glyph when it has no icon of its own", async () => {
    const { getByLabelText } = await renderCard({
      holding: holding({ name: 'Car loan', type: 'loan', metadata: { kind: 'car_loan' } }),
    });

    expect(getByLabelText('Car loan icon').props.name).toBe('car.fill');
  });

  it("shows the user's own icon over a loan's kind glyph", async () => {
    const { getByLabelText } = await renderCard({
      holding: holding({
        name: 'Car loan',
        type: 'loan',
        icon: 'star',
        metadata: { kind: 'car_loan' },
      }),
    });

    expect(getByLabelText('Car loan icon').props.name).toBe('star');
  });

  it("shows the user's own icon over the category glyph", async () => {
    const { getByLabelText } = await renderCard({
      holding: holding({
        name: 'Sedan',
        type: 'property_item',
        icon: 'star',
        metadata: { category: 'vehicle', lots: [] },
      }),
    });

    expect(getByLabelText('Sedan icon').props.name).toBe('star');
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

  it('draws the shared hairline card border on first render (matches the account card)', async () => {
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
        rateTable: { USD: 40 },
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
        rateTable: { USD: 40 },
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
});

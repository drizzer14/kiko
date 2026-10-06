import type { HoldingRow } from '@kiko/db';
import { entityColorsDark } from '@kiko/design-system/palette';

import {
  loanKindSymbol,
  genericEntitySymbol,
  defaultHoldingSymbol,
  propertyCategorySymbol,
} from '../entity-symbols';
import { holdingTypes } from '../holding-type';
import { defaultHoldingColor } from '../entity-colors';

import { holdingIdentity } from '.';

type IdentityInput = Pick<HoldingRow, 'icon' | 'color' | 'type' | 'metadata'>;

const holdingOf = (overrides: Partial<IdentityInput> = {}): IdentityInput => ({
  type: 'card',
  icon: null,
  color: null,
  metadata: null,
  ...overrides,
});

describe('holdingIdentity', () => {
  it('keeps a stored icon', () => {
    expect(holdingIdentity(holdingOf({ icon: 'star' })).icon).toBe('star');
  });

  it('falls back to the default glyph for every type when the stored icon is null', () => {
    for (const type of holdingTypes) {
      expect(holdingIdentity(holdingOf({ type })).icon).toBe(
        defaultHoldingSymbol({ type, metadata: null }),
      );
    }
  });

  it("reads a property item's default glyph from its metadata category", () => {
    const property = holdingOf({
      type: 'property_item',
      metadata: { category: 'vehicle' },
    });

    expect(holdingIdentity(property).icon).toBe(propertyCategorySymbol.vehicle);
  });

  it("reads a loan's default glyph from its metadata kind", () => {
    const loan = holdingOf({ type: 'loan', metadata: { kind: 'car_loan' } });

    expect(holdingIdentity(loan).icon).toBe(loanKindSymbol.car_loan);
  });

  it('keeps a stored valid hex color', () => {
    expect(holdingIdentity(holdingOf({ color: '#ABCDEF' })).color).toBe('#ABCDEF');
  });

  it.each([null, ''])('resolves a %p stored color to the type default for every type', (color) => {
    for (const type of holdingTypes) {
      expect(holdingIdentity(holdingOf({ type, color })).color).toBe(defaultHoldingColor[type]);
    }
  });

  it('resolves a stored color that is not a hex to the type default', () => {
    expect(holdingIdentity(holdingOf({ color: 'not-a-color' })).color).toBe(
      defaultHoldingColor.card,
    );
  });

  it('resolves an unmapped type with no stored color to the gray fallback', () => {
    const removedType = 'retired_type' as HoldingRow['type'];

    expect(holdingIdentity(holdingOf({ type: removedType })).color).toBe(entityColorsDark.gray);
  });

  it('gives an unmapped type with no stored icon the generic holding glyph, never undefined', () => {
    const removedType = 'retired_type' as HoldingRow['type'];

    expect(holdingIdentity(holdingOf({ type: removedType })).icon).toBe(
      genericEntitySymbol.holding,
    );
  });
});

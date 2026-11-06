import type { HoldingRow } from '@kiko/db';
import { type SwatchName, entityColorsDark, entityColorsLight } from '@kiko/design-system/palette';

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

const lightTwinOfDark: Record<string, string> = Object.fromEntries(
  (Object.keys(entityColorsDark) as SwatchName[]).map((name) => [
    entityColorsDark[name],
    entityColorsLight[name],
  ]),
);

describe('holdingIdentity', () => {
  it('keeps a stored icon', () => {
    expect(holdingIdentity(holdingOf({ icon: 'star' }), 'dark').icon).toBe('star');
  });

  it('falls back to the default glyph for every type when the stored icon is null', () => {
    for (const type of holdingTypes) {
      expect(holdingIdentity(holdingOf({ type }), 'dark').icon).toBe(
        defaultHoldingSymbol({ type, metadata: null }),
      );
    }
  });

  it("reads a property item's default glyph from its metadata category", () => {
    const property = holdingOf({
      type: 'property_item',
      metadata: { category: 'vehicle' },
    });

    expect(holdingIdentity(property, 'dark').icon).toBe(propertyCategorySymbol.vehicle);
  });

  it("reads a loan's default glyph from its metadata kind", () => {
    const loan = holdingOf({ type: 'loan', metadata: { kind: 'car_loan' } });

    expect(holdingIdentity(loan, 'dark').icon).toBe(loanKindSymbol.car_loan);
  });

  it('keeps a stored valid hex color', () => {
    expect(holdingIdentity(holdingOf({ color: '#ABCDEF' }), 'dark').color).toBe('#ABCDEF');
  });

  it.each([null, ''])('resolves a %p stored color to the type default for every type', (color) => {
    for (const type of holdingTypes) {
      expect(holdingIdentity(holdingOf({ type, color }), 'dark').color).toBe(
        defaultHoldingColor[type],
      );
    }
  });

  it('resolves a stored color that is not a hex to the type default', () => {
    expect(holdingIdentity(holdingOf({ color: 'not-a-color' }), 'dark').color).toBe(
      defaultHoldingColor.card,
    );
  });

  it('resolves an unmapped type with no stored color to the gray fallback', () => {
    const removedType = 'retired_type' as HoldingRow['type'];

    expect(holdingIdentity(holdingOf({ type: removedType }), 'dark').color).toBe(
      entityColorsDark.gray,
    );
  });

  it('gives an unmapped type with no stored icon the generic holding glyph, never undefined', () => {
    const removedType = 'retired_type' as HoldingRow['type'];

    expect(holdingIdentity(holdingOf({ type: removedType }), 'dark').icon).toBe(
      genericEntitySymbol.holding,
    );
  });

  describe('in the light scheme', () => {
    it('maps a stored swatch to its light twin', () => {
      expect(holdingIdentity(holdingOf({ color: entityColorsDark.teal }), 'light').color).toBe(
        entityColorsLight.teal,
      );
    });

    it('maps a lower-case stored swatch to its light twin', () => {
      expect(
        holdingIdentity(holdingOf({ color: entityColorsDark.orange.toLowerCase() }), 'light').color,
      ).toBe(entityColorsLight.orange);
    });

    it.each([null, ''])('maps the type default of a %p stored color for every type', (color) => {
      for (const type of holdingTypes) {
        expect(holdingIdentity(holdingOf({ type, color }), 'light').color).toBe(
          lightTwinOfDark[defaultHoldingColor[type]],
        );
      }
    });

    it('maps the gray fallback of an unmapped type', () => {
      const removedType = 'retired_type' as HoldingRow['type'];

      expect(holdingIdentity(holdingOf({ type: removedType }), 'light').color).toBe(
        entityColorsLight.gray,
      );
    });

    it('maps a stored hex outside the swatches through the lightness rule', () => {
      expect(holdingIdentity(holdingOf({ color: '#00FF00' }), 'light').color).toBe('#009e00');
    });

    it('leaves the icon as it is', () => {
      expect(holdingIdentity(holdingOf({ icon: 'star' }), 'light').icon).toBe('star');
    });
  });
});

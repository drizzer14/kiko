import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import { markColor } from '@kiko/design-system/entity-tint';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';

import EntityHeaderIcon from './entity-header-icon.component';

describe('EntityHeaderIcon', () => {
  it('renders the entity glyph with the identity icon name and color', async () => {
    const { getByLabelText } = await render(
      <EntityHeaderIcon identity={{ icon: 'creditcard.fill', color: '#FFD60A' }} />,
    );

    // The identity color is a palette hex, passed straight through SymbolIcon to
    // the native SFSymbolView's tintColor (already hex, so the conversion is a
    // no-op). The accessibilityLabel is derived from the icon name.
    const icon = getByLabelText('Icon creditcard.fill');
    expect(icon.props.name).toBe('creditcard.fill');
    expect(icon.props.tintColor).toBe('#FFD60A');
  });

  it('renders nothing when no identity is given (row still loading)', async () => {
    const { toJSON } = await render(<EntityHeaderIcon />);

    expect(toJSON()).toBeNull();
  });

  describe('glyph tint', () => {
    const yellowTile = lightTheme.colors.entityColors.yellow;
    const tintOf = async () => {
      const { getByLabelText } = await render(
        <EntityHeaderIcon identity={{ icon: 'creditcard.fill', color: yellowTile }} />,
      );

      return getByLabelText('Icon creditcard.fill').props.tintColor;
    };

    it('keeps the tile on the glyph in the dark world', async () => {
      expect(darkTheme.colors.entityColors.yellow).not.toBe(yellowTile);
      expect(await tintOf()).toBe(yellowTile);
    });

    describe('in the light world', () => {
      beforeEach(() => {
        registerLightThemeFirst();
      });

      afterEach(() => {
        restoreThemeOrder();
      });

      it('paints the light mark of the tile, not the tile', async () => {
        expect(markColor(yellowTile, 'light')).not.toBe(yellowTile);
        expect(await tintOf()).toBe(markColor(yellowTile, 'light'));
      });
    });
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders the Ukrainian catalog accessibility label when the locale is uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, queryByLabelText } = await render(
        <EntityHeaderIcon identity={{ icon: 'creditcard.fill', color: '#FFD60A' }} />,
      );

      expect(getByLabelText('Іконка creditcard.fill')).toBeTruthy();
      expect(queryByLabelText('Icon creditcard.fill')).toBeNull();
    });
  });
});

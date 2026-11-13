import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import { markColor } from '@kiko/design-system/entity-tint';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import type { RenderedElement } from '@kiko/test-support/rendered-element';
import { toSFSymbolTintColor } from '@kiko/design-system/components/symbol';
import { glyphNamesWithin, glyphTintsWithin } from '@kiko/test-support/glyphs-within';

import FieldTrigger from '.';

// Text's tone -> color mapping is a react-native-unistyles variant, which
// this project's Jest setup cannot resolve back out of a rendered style —
// mock Text to surface its `tone` prop through a testID instead, the same
// pattern `field-label.component.test.tsx` uses. Children still render as
// plain text, so every other query in this file is unaffected.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

describe('FieldTrigger', () => {
  it('renders the label and value and reports a press', async () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = await render(
      <FieldTrigger label="Category" onPress={onPress} value="Groceries" valueTone="textPrimary" />,
    );

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();

    await fireEvent.press(getByLabelText('Category'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Select a category"
        valueTone="textSecondary"
        required
      />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders a leading text mark when `leadingText` is passed and no `icon` is given', async () => {
    const { getByText } = await render(
      <FieldTrigger
        label="Currency"
        onPress={jest.fn()}
        value="AED — UAE Dirham"
        valueTone="textPrimary"
        leadingText="AED"
      />,
    );

    expect(getByText('AED')).toBeTruthy();
  });

  it('prefers `icon` over `leadingText` when both are somehow passed', async () => {
    const { queryByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Groceries"
        valueTone="textPrimary"
        icon="cart.fill"
        leadingText="AED"
      />,
    );

    expect(queryByText('AED')).toBeNull();
  });

  it('renders no FieldError and a plain label when `error` is undefined', async () => {
    const { queryByText } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Groceries"
        valueTone="textPrimary"
      />,
    );

    expect(queryByText('Pick one.')).toBeNull();
  });

  it('shows the FieldError message and tints the label negative when `error` is set', async () => {
    const { getByText, getByTestId } = await render(
      <FieldTrigger
        label="Category"
        onPress={jest.fn()}
        value="Select a category"
        valueTone="textSecondary"
        error="Pick one."
        testID="category-field"
      />,
    );

    expect(getByText('Pick one.')).toBeTruthy();
    expect(getByTestId('category-field-error')).toBeTruthy();
    expect(getByText('Category').props.testID).toBe('text-tone-negative');
  });

  it('tints the label negative with no error line of its own when `invalid` is set', async () => {
    const { getByText, queryByTestId } = await render(
      <FieldTrigger
        label="Return to 1"
        onPress={jest.fn()}
        value="Select holding"
        valueTone="textSecondary"
        invalid
        testID="return-field"
      />,
    );

    expect(getByText('Return to 1').props.testID).toBe('text-tone-negative');
    expect(queryByTestId('return-field-error')).toBeNull();
  });

  describe('icon tint', () => {
    const yellowTile = lightTheme.colors.entityColors.yellow;
    const iconTintsOf = async () => {
      const { getByTestId } = await render(
        <FieldTrigger
          label="Category"
          onPress={jest.fn()}
          value="Groceries"
          valueTone="textPrimary"
          icon="cart.fill"
          iconColor={yellowTile}
          testID="trigger"
        />,
      );

      return glyphTintsWithin(getByTestId('trigger'));
    };

    it('keeps the tile on the icon in the dark world', async () => {
      expect(darkTheme.colors.entityColors.yellow).not.toBe(yellowTile);
      expect(await iconTintsOf()).toEqual([
        yellowTile,
        toSFSymbolTintColor(darkTheme.colors.textSecondary),
      ]);
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
        expect(await iconTintsOf()).toEqual([
          markColor(yellowTile, 'light'),
          toSFSymbolTintColor(lightTheme.colors.textSecondary),
        ]);
      });
    });
  });

  describe('chevron', () => {
    const renderTrigger = (overrides: Partial<Parameters<typeof FieldTrigger>[0]> = {}) =>
      render(
        <FieldTrigger
          label="Category"
          onPress={jest.fn()}
          value="Groceries"
          valueTone="textPrimary"
          icon="cart.fill"
          testID="trigger"
          {...overrides}
        />,
      );
    const chevronsWithin = (root: RenderedElement) =>
      root.queryAll((node) => node.props.fallbackName === 'chevron.down');

    it('ends the field with a chevron.down at the caption icon size in the secondary tone', async () => {
      const { getByTestId } = await renderTrigger();
      const glyphs = glyphNamesWithin(getByTestId('trigger'));
      const [chevron] = chevronsWithin(getByTestId('trigger'));

      expect(glyphs).toEqual(['cart.fill', 'chevron.down']);
      expect(chevron.props.size).toBe(darkTheme.iconSizes.caption);
      expect(chevron.props.tintColor).toBe(toSFSymbolTintColor(darkTheme.colors.textSecondary));
    });

    it('hides the chevron from accessibility', async () => {
      const { getByTestId } = await renderTrigger();
      const [chevron] = chevronsWithin(getByTestId('trigger'));

      expect(chevron.parent?.props.accessibilityElementsHidden).toBe(true);
      expect(chevron.parent?.props.importantForAccessibility).toBe('no-hide-descendants');
    });

    it('renders the chevron after the trailing content', async () => {
      const { getByTestId } = await renderTrigger({
        trailing: <RNText testID="trailing-caption">Savings</RNText>,
      });
      const inOrder = getByTestId('trigger').queryAll(
        (node) =>
          node.props.testID === 'trailing-caption' || node.props.fallbackName === 'chevron.down',
      );

      expect(inOrder.map((node) => node.props.testID ?? node.props.fallbackName)).toEqual([
        'trailing-caption',
        'chevron.down',
      ]);
    });

    it('dims the chevron with a disabled field', async () => {
      const { getByTestId } = await renderTrigger({ disabled: true });
      const [chevron] = chevronsWithin(getByTestId('trigger'));

      expect(StyleSheet.flatten(ancestorWithStyle(chevron, 'opacity').props.style).opacity).toBe(
        0.5,
      );
    });

    it('keeps the transparent fieldBackground fill in dark with the chevron', async () => {
      const { getByTestId } = await renderTrigger();
      const [chevron] = chevronsWithin(getByTestId('trigger'));
      const fill = StyleSheet.flatten(ancestorWithStyle(chevron, 'backgroundColor').props.style);

      expect(fill.backgroundColor).toBe(darkTheme.colors.fieldBackground);
      expect(fill.backgroundColor).toBe('transparent');
    });

    it('lets a long value wrap: the value box grows and shrinks, the Text sets no numberOfLines', async () => {
      const { getByText } = await renderTrigger({
        value: 'A very long category name that wraps at accessibility text sizes',
      });
      const text = getByText('A very long category name that wraps at accessibility text sizes');

      expect(text.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(text.parent?.props.style)).toMatchObject({
        flexGrow: 1,
        flexShrink: 1,
      });
    });

    it('ends a capped field with the chevron too', async () => {
      const { getByTestId, getByText } = await renderTrigger({ capped: true });
      const glyphs = glyphNamesWithin(getByTestId('trigger'));

      expect(glyphs).toEqual(['cart.fill', 'chevron.down']);
      expect(StyleSheet.flatten(getByText('Groceries').parent?.props.style).flexShrink).toBe(1);
      expect(StyleSheet.flatten(getByTestId('trigger').props.style).maxWidth).toBe(
        darkTheme.layout.selectTriggerMaxWidth,
      );
    });
  });
});

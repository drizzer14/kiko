import type { ComponentProps } from 'react';
import { Alert, TextInput } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { KIKO_CATEGORIES_ICONS } from '@kiko/design-system/components/icon-pools';
import { expectNavBarSaveOnly, pressSave, saveItem } from '@kiko/test-support/form-header-items';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoryFormScreen from './category-form.screen';

type CategoryData = { key: string; title: string; icon: string; color: string | null };

const mockCreate = jest.fn();
const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockUpdateColor = jest.fn();
let mockCategories: CategoryData[] = [];

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    updateTitle: (...args: unknown[]) => mockUpdateTitle(...args),
    updateIcon: (...args: unknown[]) => mockUpdateIcon(...args),
    updateColor: (...args: unknown[]) => mockUpdateColor(...args),
  },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockCategories, isLoading: false, isFresh: true }),
}));

type FormProps = ComponentProps<typeof CategoryFormScreen>;

const navigation = navigationSpy();

const formElement = (categoryKey?: string) => (
  <CategoryFormScreen
    navigation={asNavigationProp<FormProps['navigation']>(navigation)}
    route={asRouteProp<FormProps['route']>('CategoryForm', { categoryKey })}
  />
);

const renderForm = (categoryKey?: string) => render(formElement(categoryKey));

// The swatch the colour picker rings when a new category's form opens: the palette's own fallback
// for the placeholder key, read from the same resolver the form uses.
const openPreviewHex = resolveCategoryColor(null, 'new-category');
const openSwatchName = Object.entries(darkTheme.colors.entityColors).find(
  ([, hex]) => hex === openPreviewHex,
)?.[0];

const GROCERIES: CategoryData = {
  key: 'groceries',
  title: 'Groceries',
  icon: 'cart',
  color: darkTheme.colors.entityColors.khaki,
};

describe('CategoryFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue('new-key');
    mockCategories = [GROCERIES, { key: 'trips', title: 'Trips', icon: 'airplane', color: null }];
  });

  describe('creating a category', () => {
    it('shows the name, icon and colour fields, and no delete', async () => {
      const { getByLabelText, getByText, queryByText } = await renderForm();

      expect(getByLabelText('Name')).toBeTruthy();
      expect(getByLabelText('Change Icon')).toBeTruthy();
      expect(getByText('Color')).toBeTruthy();
      expect(queryByText('Delete')).toBeNull();
    });

    it('offers Save only as the nav-bar item, not in the body', async () => {
      const utils = await renderForm();

      expectNavBarSaveOnly(navigation.setOptions, utils);
    });

    it('leaves Save enabled before anything is typed, and checks the name on press', async () => {
      await renderForm();

      expect(saveItem(navigation.setOptions)?.disabled).toBe(false);
    });

    it('keeps the stack title, which already reads "New Category"', async () => {
      await renderForm();

      expect(navigation.setOptions).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.anything() }),
      );
    });

    it('focuses the name input on mount, deferred to the next frame, without native autoFocus', async () => {
      const focusSpy = jest.spyOn(TextInput.prototype, 'focus');

      const { getByLabelText } = await renderForm();

      await waitFor(() => expect(focusSpy).toHaveBeenCalled());
      expect(getByLabelText('Name').props.autoFocus).toBeUndefined();

      focusSpy.mockRestore();
    });

    it('offers the default new-category icon in the category picker pool', () => {
      expect(KIKO_CATEGORIES_ICONS).toContain(genericEntitySymbol.category);
    });

    it('rings a concrete default colour on open without choosing one', async () => {
      expect(openSwatchName).toBeDefined();

      const { getByLabelText } = await renderForm();

      expect(getByLabelText(`Color ${openSwatchName}`).props.accessibilityState.selected).toBe(
        true,
      );
    });

    it('moves the ring to a swatch the user taps', async () => {
      const { getByLabelText } = await renderForm();
      const pickedName = openSwatchName === 'red' ? 'blue' : 'red';

      await fireEvent.press(getByLabelText(`Color ${pickedName}`));

      expect(getByLabelText(`Color ${pickedName}`).props.accessibilityState.selected).toBe(true);
      expect(getByLabelText(`Color ${openSwatchName}`).props.accessibilityState.selected).toBe(
        false,
      );
    });

    it('saves the name with the default icon and no colour when none was picked', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), '  Travel  ');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(mockCreate).toHaveBeenCalledWith({ title: 'Travel', icon: 'tag', color: null }),
      );
    });

    it('saves the icon and the colour the user picked', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon basket'));
      await fireEvent.press(getByLabelText('Color yellow'));
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(mockCreate).toHaveBeenCalledWith({
          title: 'Travel',
          icon: 'basket',
          color: darkTheme.colors.entityColors.yellow,
        }),
      );
    });

    it('opens the page of the category it made, in place of the form', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith('CategoryDetail', {
          categoryKey: 'new-key',
        }),
      );
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('shows a name-required error and creates nothing when Save is pressed with a blank name', async () => {
      const { findByText } = await renderForm();

      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('refuses a whitespace-only name the same way', async () => {
      const { getByLabelText, findByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), '   ');
      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('clears the error once a name is typed', async () => {
      const { getByLabelText, findByText, queryByText } = await renderForm();

      await pressSave(navigation.setOptions);
      expect(await findByText('Enter a name.')).toBeTruthy();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');

      expect(queryByText('Enter a name.')).toBeNull();
    });

    it('creates once even when Save is pressed twice quickly', async () => {
      let resolveCreate: (key: string) => void = () => {};
      mockCreate.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
      );
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      expect(saveItem(navigation.setOptions)?.disabled).toBe(true);

      // The bar item is disabled while the write is pending, so the second tap is the raw handler.
      await act(async () => {
        saveItem(navigation.setOptions)?.onPress();
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);

      resolveCreate('new-key');
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
    });

    it('alerts and stays on the form when the write fails', async () => {
      mockCreate.mockRejectedValue(new Error('disk full'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
      );
      expect(navigation.replace).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });

  describe('editing a category', () => {
    it('titles the screen "Edit Category"', async () => {
      await renderForm('groceries');

      expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Category' });
    });

    it('opens with the stored name, icon and colour', async () => {
      const { getByLabelText, getByDisplayValue } = await renderForm('groceries');

      expect(getByDisplayValue('Groceries')).toBeTruthy();
      expect(
        getByLabelText('Change Icon').queryAll((node) => node.props.name === 'cart').length,
      ).toBeGreaterThan(0);
      expect(getByLabelText('Color khaki').props.accessibilityState.selected).toBe(true);
    });

    it('offers no delete', async () => {
      const { queryByText } = await renderForm('groceries');

      expect(queryByText('Delete')).toBeNull();
    });

    it('saves a changed name, icon and colour through their own writes, then goes back', async () => {
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), '  Food  ');
      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon basket'));
      await fireEvent.press(getByLabelText('Color yellow'));
      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
      expect(mockUpdateIcon).toHaveBeenCalledWith('groceries', 'basket');
      expect(mockUpdateColor).toHaveBeenCalledWith(
        'groceries',
        darkTheme.colors.entityColors.yellow,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('writes only what changed', async () => {
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
      expect(mockUpdateIcon).not.toHaveBeenCalled();
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing changed', async () => {
      await renderForm('groceries');

      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(mockUpdateIcon).not.toHaveBeenCalled();
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('saves no colour for a category that has none and whose colour was not picked', async () => {
      await renderForm('trips');

      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('refuses a blank name and writes nothing', async () => {
      const { getByLabelText, findByText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), '   ');
      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('alerts and stays on the form when a write fails', async () => {
      mockUpdateTitle.mockRejectedValue(new Error('disk full'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
      );
      expect(navigation.goBack).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('disables Save until the category has loaded', async () => {
      mockCategories = [];
      await renderForm('groceries');

      expect(saveItem(navigation.setOptions)?.disabled).toBe(true);
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('enables Save once the category has loaded', async () => {
      mockCategories = [];
      const { rerender } = await renderForm('groceries');

      mockCategories = [GROCERIES];
      await act(async () => {
        await rerender(formElement('groceries'));
      });

      expect(saveItem(navigation.setOptions)?.disabled).toBe(false);
    });

    it('keeps the user’s edits when the category refreshes', async () => {
      const { getByLabelText, getByDisplayValue, rerender } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      mockCategories = [{ ...GROCERIES, title: 'Groceries again' }];
      await act(async () => {
        await rerender(formElement('groceries'));
      });

      expect(getByDisplayValue('Food')).toBeTruthy();
    });

    describe('under the uk language', () => {
      beforeEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
      });

      afterEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      });

      it('shows a seeded default under its Ukrainian title and does not rename it unless edited', async () => {
        const { getByDisplayValue } = await renderForm('groceries');

        expect(getByDisplayValue('Продукти')).toBeTruthy();

        await pressSave(navigation.setOptions, 'Зберегти');

        await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
        expect(mockUpdateTitle).not.toHaveBeenCalled();
      });
    });
  });
});

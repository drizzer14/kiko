import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemButton,
} from '@react-navigation/native-stack';
import { darkTheme } from '@kiko/design-system/theme';
import { renderHook } from '@testing-library/react-native';
import { navigationSpy } from '@kiko/test-support/navigation-props';

import { useFormHeaderItems } from '.';

type HeaderOptions = {
  unstable_headerLeftItems?: (props: { canGoBack?: boolean }) => NativeStackHeaderItem[];
  unstable_headerRightItems?: (props: { canGoBack?: boolean }) => NativeStackHeaderItem[];
};

type HookProps = { onSave: () => void; hasSave: boolean; isSaving: boolean };

const navigation = navigationSpy();

const lastOptions = (): HeaderOptions => {
  const calls = navigation.setOptions.mock.calls;

  return calls[calls.length - 1][0];
};

const leftItems = (canGoBack: boolean) =>
  lastOptions().unstable_headerLeftItems?.({ canGoBack }) ?? [];

const rightItems = () => lastOptions().unstable_headerRightItems?.({ canGoBack: false }) ?? [];

const renderItems = async (initialProps: HookProps) =>
  renderHook((props: HookProps) => useFormHeaderItems({ navigation, ...props }), {
    initialProps,
  });

describe('useFormHeaderItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('the leading slot', () => {
    it('offers Cancel when the screen has no back button, and Cancel closes it like back does', async () => {
      await renderItems({ onSave: jest.fn(), hasSave: true, isSaving: false });

      const [cancel, ...others] = leftItems(false);

      expect(others).toEqual([]);
      expect(cancel).toMatchObject({
        type: 'button',
        label: 'Cancel',
        accessibilityLabel: 'Cancel',
        variant: 'plain',
        tintColor: darkTheme.colors.textPrimary,
      });

      (cancel as { onPress: () => void }).onPress();

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('offers nothing when the screen has a back button, which already closes it', async () => {
      await renderItems({ onSave: jest.fn(), hasSave: true, isSaving: false });

      expect(leftItems(true)).toEqual([]);
    });
  });

  describe('the trailing slot', () => {
    it('offers a prominent Save on every layout', async () => {
      await renderItems({ onSave: jest.fn(), hasSave: true, isSaving: false });

      const items = rightItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'button',
        label: 'Save',
        accessibilityLabel: 'Save',
        variant: 'prominent',
        tintColor: darkTheme.colors.accent,
        sharesBackground: false,
        disabled: false,
      });
      expect(
        [...leftItems(true), ...leftItems(false), ...items].some((item) => item.type === 'custom'),
      ).toBe(false);
    });

    it('runs the latest save without registering the header again', async () => {
      const firstSave = jest.fn();
      const nextSave = jest.fn();
      const { rerender } = await renderItems({
        onSave: firstSave,
        hasSave: true,
        isSaving: false,
      });
      const registrations = navigation.setOptions.mock.calls.length;

      await rerender({ onSave: nextSave, hasSave: true, isSaving: false });
      (rightItems()[0] as { onPress: () => void }).onPress();

      expect(nextSave).toHaveBeenCalledTimes(1);
      expect(firstSave).not.toHaveBeenCalled();
      expect(navigation.setOptions).toHaveBeenCalledTimes(registrations);
    });

    it('disables Save while a save is in flight', async () => {
      const { rerender } = await renderItems({
        onSave: jest.fn(),
        hasSave: true,
        isSaving: false,
      });

      await rerender({ onSave: jest.fn(), hasSave: true, isSaving: true });

      expect(rightItems()[0]).toMatchObject({ label: 'Save', disabled: true });
    });

    it('offers no Save for a screen with nothing to save', async () => {
      await renderItems({ onSave: jest.fn(), hasSave: false, isSaving: false });

      expect(rightItems()).toEqual([]);
    });

    describe('with extra items', () => {
      const starItem: NativeStackHeaderItemButton = {
        type: 'button',
        label: 'Set as default',
        icon: { type: 'sfSymbol', name: 'star' },
        onPress: jest.fn(),
      };
      const flagItem: NativeStackHeaderItemButton = {
        type: 'button',
        label: 'Flag',
        icon: { type: 'sfSymbol', name: 'flag' },
        onPress: jest.fn(),
      };

      it('lists them in order before Save', async () => {
        await renderHook(() =>
          useFormHeaderItems({
            navigation,
            onSave: jest.fn(),
            hasSave: true,
            isSaving: false,
            extraItems: [starItem, flagItem],
          }),
        );

        expect(rightItems().map((item) => (item as { label: string }).label)).toEqual([
          'Set as default',
          'Flag',
          'Save',
        ]);
      });

      it('lists them even for a screen with nothing to save', async () => {
        await renderHook(() =>
          useFormHeaderItems({
            navigation,
            onSave: jest.fn(),
            hasSave: false,
            isSaving: false,
            extraItems: [starItem],
          }),
        );

        expect(rightItems()).toEqual([starItem]);
      });

      it('registers the header again when the items change', async () => {
        const { rerender } = await renderHook(
          (props: { extraItems: NativeStackHeaderItemButton[] }) =>
            useFormHeaderItems({
              navigation,
              onSave: jest.fn(),
              hasSave: true,
              isSaving: false,
              extraItems: props.extraItems,
            }),
          { initialProps: { extraItems: [starItem] } },
        );

        await rerender({ extraItems: [flagItem] });

        expect(rightItems().map((item) => (item as { label: string }).label)).toEqual([
          'Flag',
          'Save',
        ]);
      });
    });
  });
});

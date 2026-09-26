import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

// Register the design-system theme so `useUnistyles()` resolves inside this
// isolated render (the app entry imports it transitively; a lone component test
// must import it itself).
import '../../../design-system/unistyles';
// Initialize i18next so the FAB's accessibility label resolves to the real
// catalogue string rather than the bare key.
import '@kiko/i18n/init';
import { darkTheme } from '../../../design-system/theme';
import { asNavigationProp, navigationSpy } from '../../../test-support/navigation-props';

import AddTransactionFab from './add-transaction-fab.component';

describe('AddTransactionFab', () => {
  it('renders a labeled floating action button', async () => {
    const { getByLabelText } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={0} />,
    );

    expect(getByLabelText('Add transaction')).toBeTruthy();
  });

  it('navigates to the create form with EMPTY params when pressed (global add)', async () => {
    // The FAB opens the shared Transaction form with no holding fixed — the
    // empty-create member of the union — so the form shows its own primary-leg
    // holding picker. Wiring is verified through a mock navigation, exactly as
    // Home wires it.
    const navigation = navigationSpy();
    const navigationProp = asNavigationProp<{
      navigate: (name: string, params: Record<string, never>) => void;
    }>(navigation);

    const { getByLabelText } = await render(
      <AddTransactionFab
        onPress={() => navigationProp.navigate('TransactionForm', {})}
        bottomOffset={0}
      />,
    );

    await fireEvent.press(getByLabelText('Add transaction'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', {});
  });

  it('lifts itself above the given bottom clearance', async () => {
    // The FAB sits OUTSIDE the scrolling list content and must clear the
    // floating tab bar, so its bottom offset is driven by the list's own
    // clearance plus the standard screen inset — never overlapping the tab bar.
    const { getByLabelText } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={100} />,
    );

    const fab = getByLabelText('Add transaction');
    const flattened = Array.isArray(fab.props.style)
      ? Object.assign({}, ...fab.props.style)
      : fab.props.style;

    // The offset is the clearance plus a positive gap, so the button floats
    // clear of the tab bar rather than resting on it.
    expect(flattened.bottom).toBeGreaterThan(100);
  });

  it('paints its background with the shared translucent GlassSurface, not a flat accent fill', async () => {
    // The FAB's circular background must be the design system's shared
    // GlassSurface (neutral `transparent` variant), never a hand-rolled glass
    // effect or the old flat accent circle. `GlassSurface` renders a layer
    // testID'd `${testID}-base` under jest's non-glass fallback (see its own
    // test file) — its presence is proof the real component tree renders,
    // not just a plain colored View standing in for it.
    const { getByLabelText, getByTestId } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={0} />,
    );

    expect(getByTestId('add-transaction-fab-glass')).toBeTruthy();
    expect(getByTestId('add-transaction-fab-glass-base')).toBeTruthy();

    const fab = getByLabelText('Add transaction');
    const flattened = StyleSheet.flatten(fab.props.style);

    // The flat accent circle is gone: the touch target itself must no longer
    // paint the solid accent color now that the visible background is glass.
    expect(flattened.backgroundColor).not.toBe(darkTheme.colors.accent);
  });

  it('wires the GlassSurface to the translucent (transparent) variant, not a plain opaque surface', async () => {
    // `not.toBe(accent)` above is satisfied by ANY non-accent fill, including
    // GlassSurface's own PLAIN-surface fallback (`theme.colors.surface`) — it
    // would still pass even if the component dropped the `transparent` prop
    // entirely. This asserts the actual fill GlassSurface's non-glass fallback
    // paints for `transparent` specifically (`surfaceTranslucent`, per
    // `glass-surface.styles.ts`'s `resolveFallbackFill`), which is the one
    // value that proves the FAB requests the translucent variant rather than
    // an opaque one.
    const { getByTestId } = await render(
      <AddTransactionFab onPress={() => undefined} bottomOffset={0} />,
    );

    const base = StyleSheet.flatten(getByTestId('add-transaction-fab-glass-base').props.style);

    expect(base.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(base.backgroundColor).not.toBe(darkTheme.colors.surface);
  });
});

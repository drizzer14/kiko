import { fireEvent, render } from '@testing-library/react-native';

// Register the design-system theme so `useUnistyles()` resolves inside this
// isolated render (the app entry imports it transitively; a lone component test
// must import it itself).
import '../../../design-system/unistyles';
// Initialize i18next so the FAB's accessibility label resolves to the real
// catalogue string rather than the bare key.
import '../../../i18n';
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
});

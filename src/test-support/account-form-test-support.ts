import { act, fireEvent, type render } from '@testing-library/react-native';

// Opens the AccountKindField sheet and picks the given kind — every kind
// switch goes through this trigger-press -> option-press pair, matching
// the field's own sheet-based interaction.
export const selectKind = async (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
  kind: 'bank' | 'cash' | 'crypto' | 'property' | 'metals' | 'debt' | 'broker',
): Promise<void> => {
  await fireEvent.press(getByTestId('account-kind-field'));
  const sheet = getByTestId('account-kind-field-sheet-modal');
  await fireEvent.press(getByTestId(`account-kind-field-option-${kind}`));
  // The sheet's close animation ending, which is when a swap may navigate.
  await act(async () => sheet.props.onDismiss());
};

// A mocked sync hook module for an account form test that never runs a sync: the hook reports
// it idle and hands back the test's own `sync` spy. A test installs it with
// `jest.mock('@kiko/sync/use-sync', () =>
//   require('@kiko/test-support/account-form-test-support').idleSyncModule('useSync', (...args) =>
//     mockSync(...args)))`
// where the arrow keeps the `mock`-prefixed spy lazy, so the hoisted factory may close over it.
// A string `require` is invisible to Knip: the file stays used through the tests' `selectKind`.
export const idleSyncModule = (
  hookName: 'useSync' | 'useCryptoSync',
  sync: (...args: unknown[]) => unknown,
) => ({
  [hookName]: () => ({ isSyncing: false, error: undefined, sync }),
});

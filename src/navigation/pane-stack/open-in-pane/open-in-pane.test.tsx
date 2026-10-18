import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { PaneActions } from '../pane-router';

import { OpenInPaneContext, useOpenInPane } from '.';

const mockNavigate = jest.fn();
// A navigation object keeps its identity across renders, like the real one.
const mockNavigation = { navigate: mockNavigate };
const mockRoute = { key: 'Home-key' };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => mockRoute,
  useNavigation: () => mockNavigation,
}));

const dispatchProvider =
  (dispatch: jest.Mock) =>
  ({ children }: { children: ReactNode }) => (
    <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
  );

describe('useOpenInPane', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('dispatches a pane open that names the calling route as the opener', async () => {
    const dispatch = jest.fn();
    const { result } = await renderHook(() => useOpenInPane(), {
      wrapper: dispatchProvider(dispatch),
    });

    result.current('TransactionForm', { transactionId: 't1' });

    expect(dispatch).toHaveBeenCalledWith(
      PaneActions.open('Home-key', 'TransactionForm', { transactionId: 't1' }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates the ordinary way outside a pane stack', async () => {
    const { result } = await renderHook(() => useOpenInPane());

    result.current('TransactionForm', { transactionId: 't1' });

    expect(mockNavigate).toHaveBeenCalledWith('TransactionForm', { transactionId: 't1' });
  });

  it('keeps one function while the opener and the dispatcher stay the same', async () => {
    const { result, rerender } = await renderHook(() => useOpenInPane(), {
      wrapper: dispatchProvider(jest.fn()),
    });
    const first = result.current;

    await rerender({});

    expect(result.current).toBe(first);
  });
});

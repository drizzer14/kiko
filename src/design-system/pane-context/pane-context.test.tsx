import { renderHook } from '@testing-library/react-native';

import { PaneContext, paneContextOf, usePaneContext } from '.';

describe('paneContextOf', () => {
  it.each([
    ['columns', 'companion', { top: true, right: false, bottom: true, left: true }],
    ['columns', 'primary', { top: true, right: true, bottom: true, left: false }],
    ['rows', 'companion', { top: true, right: true, bottom: false, left: true }],
    ['rows', 'primary', { top: false, right: true, bottom: true, left: true }],
  ] as const)('puts the %s %s pane against the window edges %j', (mode, pane, edges) => {
    expect(paneContextOf(mode, pane)).toEqual({ edges });
  });

  it('hands out one object for a pane, so a consumer is not re-rendered by a new identity', () => {
    expect(paneContextOf('rows', 'primary')).toBe(paneContextOf('rows', 'primary'));
  });

  it.each([
    ['columns', 'companion', { top: false, right: false, bottom: true, left: true }],
    ['columns', 'primary', { top: false, right: true, bottom: true, left: false }],
    ['rows', 'companion', { top: false, right: true, bottom: false, left: true }],
    ['rows', 'primary', { top: false, right: true, bottom: true, left: true }],
  ] as const)(
    'drops only the top edge of the %s %s pane when it lies below the top-bar band',
    (mode, pane, edges) => {
      expect(paneContextOf(mode, pane, true)).toEqual({ edges });
    },
  );

  it('hands out one flagged object per pane, distinct from the unflagged one', () => {
    expect(paneContextOf('columns', 'primary', true)).toBe(
      paneContextOf('columns', 'primary', true),
    );
    expect(paneContextOf('columns', 'primary', true)).not.toBe(paneContextOf('columns', 'primary'));
    expect(paneContextOf('columns', 'primary', true)).not.toBe(
      paneContextOf('columns', 'companion', true),
    );
  });

  it('keeps the unflagged context when the flag is false', () => {
    expect(paneContextOf('columns', 'primary', false)).toBe(paneContextOf('columns', 'primary'));
    expect(paneContextOf('columns', 'primary', false).edges.top).toBe(true);
  });
});

describe('usePaneContext', () => {
  it('is null outside a pane', async () => {
    const { result } = await renderHook(() => usePaneContext());

    expect(result.current).toBeNull();
  });

  it('reads the pane it is rendered in', async () => {
    const { result } = await renderHook(() => usePaneContext(), {
      wrapper: ({ children }) => (
        <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
          {children}
        </PaneContext.Provider>
      ),
    });

    expect(result.current).toBe(paneContextOf('columns', 'companion'));
  });
});

import type { FC } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { PaneWidthContext } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { useTitleFit } from './use-title-fit';

// The global manual mock reports "fits"; this file tests the real hook.
jest.unmock('./use-title-fit');

// The title's line depends on where the tab bar sits: a side bar gives the content a wider margin.
const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useTabBarEdge: () => mockUseTabBarEdge(),
}));

const HIDDEN = { includeHiddenElements: true };

const ONE_LINE = 41;
const TWO_LINES = 82;

const layoutOf = (height: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width: 343, height } },
});

const Probe: FC<{ title: string }> = ({ title }) => {
  const { fits, measurer } = useTitleFit(title);

  return (
    <>
      <Text testID="fits">{String(fits)}</Text>

      {measurer}
    </>
  );
};

describe('useTitleFit', () => {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 375, height: 812, scale: 3, fontScale: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockUseTabBarEdge.mockReturnValue('none');
  });

  describe('the line the measurer lays the title out in', () => {
    const measuredWidthAt = async (tabBarEdge: ReturnType<typeof mockUseTabBarEdge>) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);
      jest
        .spyOn(Dimensions, 'get')
        .mockReturnValue({ width: 466, height: 678, scale: 3, fontScale: 1 });

      const { getByTestId } = await render(<Probe title="Edit Account" />);

      return StyleSheet.flatten(getByTestId('title-measurer', HIDDEN).props.style).width;
    };

    it.each(['leading', 'trailing'] as const)(
      'is the window width minus two 20pt margins under a %s side bar',
      async (tabBarEdge) => {
        expect(await measuredWidthAt(tabBarEdge)).toBe(426);
      },
    );

    it('is the window width minus two 16pt margins under a bottom bar', async () => {
      expect(await measuredWidthAt('bottom')).toBe(434);
    });
  });

  it('starts from the estimate: a short title fits on the first render', async () => {
    const { getByTestId } = await render(<Probe title="Edit Account" />);

    expect(getByTestId('fits').props.children).toBe('true');
  });

  it('starts from the estimate: a clearly long title does not fit on the first render', async () => {
    const { getByTestId } = await render(
      <Probe title="Edit, Duplicate, or Delete a Transaction" />,
    );

    expect(getByTestId('fits').props.children).toBe('false');
  });

  // 20 letters "a" are estimated just under the 343pt line (375pt window, two 16pt margins) and
  // 21 just over it, so a margin of anything but 16pt moves this boundary.
  it('gives the title the window width minus the two side margins', async () => {
    const fitting = await render(<Probe title={'a'.repeat(20)} />);
    const over = await render(<Probe title={'a'.repeat(21)} />);

    expect(fitting.getByTestId('fits').props.children).toBe('true');
    expect(over.getByTestId('fits').props.children).toBe('false');
  });

  // In columns each pane has its own header at about half the window, so a title that fits the
  // window (20 letters, as above) can still be wider than the pane (187pt less 32pt of margins).
  describe('in a pane', () => {
    const inPane = (width: number, title: string) => (
      <PaneWidthContext.Provider value={width}>
        <Probe title={title} />
      </PaneWidthContext.Provider>
    );

    it('gives the title the pane width, not the window width', async () => {
      const { getByTestId } = await render(inPane(187, 'a'.repeat(20)));

      expect(getByTestId('fits').props.children).toBe('false');
    });

    it('still fits a title the pane holds', async () => {
      const { getByTestId } = await render(inPane(187, 'a'.repeat(8)));

      expect(getByTestId('fits').props.children).toBe('true');
    });

    it('gives a pane as wide as the window the same line, as in rows', async () => {
      const fitting = await render(inPane(375, 'a'.repeat(20)));
      const over = await render(inPane(375, 'a'.repeat(21)));

      expect(fitting.getByTestId('fits').props.children).toBe('true');
      expect(over.getByTestId('fits').props.children).toBe('false');
    });
  });

  it('lets a one line measurement overrule a pessimistic estimate', async () => {
    const { getByTestId } = await render(
      <Probe title="Edit, Duplicate, or Delete a Transaction" />,
    );

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(ONE_LINE));

    expect(getByTestId('fits').props.children).toBe('true');
  });

  it('lets a wrapped measurement overrule an optimistic estimate', async () => {
    const { getByTestId } = await render(<Probe title="Edit Account" />);

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(TWO_LINES));

    expect(getByTestId('fits').props.children).toBe('false');
  });

  // A window as wide as the two 16pt side margins (32pt) leaves a line of nothing, as one with
  // no width at all does.
  it.each([
    ['no width', 0],
    ['only the two side margins of width', 32],
  ])(
    'counts a title as fitting, and measures nothing, in a window with %s',
    async (_name, width) => {
      jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 812, scale: 3, fontScale: 1 });

      const { getByTestId, queryByTestId } = await render(
        <Probe title="Edit, Duplicate, or Delete a Transaction" />,
      );

      expect(getByTestId('fits').props.children).toBe('true');
      expect(queryByTestId('title-measurer', HIDDEN)).toBeNull();
    },
  );

  it('drops a measurement once the title changes, and measures the new title', async () => {
    const { getByTestId, rerender } = await render(<Probe title="Edit Account" />);

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(TWO_LINES));
    await rerender(<Probe title="Edit Rule" />);

    expect(getByTestId('fits').props.children).toBe('true');

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(TWO_LINES));

    expect(getByTestId('fits').props.children).toBe('false');
  });
});

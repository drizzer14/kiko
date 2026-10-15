import type { FC } from 'react';
import { Dimensions, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { useTitleFit } from './use-title-fit';

// The global manual mock reports "fits"; this file tests the real hook.
jest.unmock('./use-title-fit');

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

  it('drops a measurement once the title changes, and measures the new title', async () => {
    const { getByTestId, rerender } = await render(<Probe title="Edit Account" />);

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(TWO_LINES));
    await rerender(<Probe title="Edit Rule" />);

    expect(getByTestId('fits').props.children).toBe('true');

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(TWO_LINES));

    expect(getByTestId('fits').props.children).toBe('false');
  });
});

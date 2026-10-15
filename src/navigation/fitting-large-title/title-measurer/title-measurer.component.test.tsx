import { darkTheme } from '@kiko/design-system/theme';
import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import TitleMeasurer from './title-measurer.component';

// The measurer is invisible by design, so queries must look at hidden elements.
const HIDDEN = { includeHiddenElements: true };

const LINE_HEIGHT = darkTheme.typography.largeTitle.lineHeight;

const layoutOf = (height: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width: 343, height } },
});

describe('TitleMeasurer', () => {
  it('lays out the whole title, so a long one wraps into more lines', async () => {
    const { getByText } = await render(
      <TitleMeasurer title="A long title" availableWidth={343} onFitChange={jest.fn()} />,
    );

    expect(getByText('A long title', HIDDEN).props.numberOfLines).toBeUndefined();
  });

  it('measures the title at a fixed size, like the native large title', async () => {
    const { getByText } = await render(
      <TitleMeasurer title="A long title" availableWidth={343} onFitChange={jest.fn()} />,
    );

    expect(getByText('A long title', HIDDEN).props.allowFontScaling).toBe(false);
  });

  it('stays out of the way of touches and of the screen reader', async () => {
    const { getByTestId } = await render(
      <TitleMeasurer title="A long title" availableWidth={343} onFitChange={jest.fn()} />,
    );
    const container = getByTestId('title-measurer', HIDDEN);

    expect(container.props.accessibilityElementsHidden).toBe(true);
    expect(container.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('reports a one line title as fitting', async () => {
    const onFitChange = jest.fn();
    const { getByTestId } = await render(
      <TitleMeasurer title="Edit Account" availableWidth={343} onFitChange={onFitChange} />,
    );

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(LINE_HEIGHT));

    expect(onFitChange).toHaveBeenCalledTimes(1);
    expect(onFitChange).toHaveBeenCalledWith(true);
  });

  it('reports a title that wraps onto a second line as not fitting', async () => {
    const onFitChange = jest.fn();
    const { getByTestId } = await render(
      <TitleMeasurer title="A very long title" availableWidth={343} onFitChange={onFitChange} />,
    );

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(LINE_HEIGHT * 2));

    expect(onFitChange).toHaveBeenCalledWith(false);
  });

  it('reports a measurement with no height as fitting', async () => {
    const onFitChange = jest.fn();
    const { getByTestId } = await render(
      <TitleMeasurer title="Edit Account" availableWidth={343} onFitChange={onFitChange} />,
    );

    await fireEvent(getByTestId('title-measurer', HIDDEN), 'layout', layoutOf(0));

    expect(onFitChange).toHaveBeenCalledWith(true);
  });
});

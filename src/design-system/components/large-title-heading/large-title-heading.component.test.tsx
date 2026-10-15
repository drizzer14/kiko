import { darkTheme } from '@kiko/design-system/theme';
import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import LargeTitleHeading from '.';
import {
  LargeTitleHeadingContext,
  type LargeTitleHeadingValue,
} from './large-title-heading.context';

const headingValue = (
  title: string,
  overrides: Partial<LargeTitleHeadingValue> = {},
): LargeTitleHeadingValue => ({
  title,
  scrolled: false,
  headingBottom: { current: 0 },
  onScrolledChange: jest.fn(),
  onHostedChange: jest.fn(),
  ...overrides,
});

describe('LargeTitleHeading', () => {
  it('renders nothing when the native large title shows the title', async () => {
    const { toJSON } = await render(<LargeTitleHeading />);

    expect(toJSON()).toBeNull();
  });

  it('shows the whole title as a heading for the screen reader', async () => {
    const { getByRole } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('A long title')}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );

    expect(getByRole('header').props.children).toBe('A long title');
  });

  // The 34pt, bold, line-height-41 look is the `largeTitle` token, pinned in theme.test.ts;
  // Unistyles resolves it natively, so what jest can see is the unscaled size and the wrapping.
  it('wraps the title instead of cutting it, at the fixed size of the native large title', async () => {
    const { getByRole } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('A long title')}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );
    const title = getByRole('header');

    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.allowFontScaling).toBe(false);
  });

  // The bar shows the title once the heading has scrolled under it; the screen reader must not
  // read it a second time.
  it('is out of the screen reader once it has scrolled under the bar', async () => {
    const { getByTestId } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('A long title', { scrolled: true })}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );
    const heading = getByTestId('large-title-heading', { includeHiddenElements: true });

    expect(heading.props.accessibilityElementsHidden).toBe(true);
    expect(heading.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('is in the screen reader while it shows below the bar', async () => {
    const { getByTestId } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('A long title')}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );
    const heading = getByTestId('large-title-heading');

    expect(heading.props.accessibilityElementsHidden).toBe(false);
    expect(heading.props.importantForAccessibility).toBe('auto');
  });

  it('tells the navigator layout that a screen hosts it, and that it is gone', async () => {
    const value = headingValue('A long title');
    const { unmount } = await render(
      <LargeTitleHeadingContext.Provider value={value}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );

    expect(value.onHostedChange).toHaveBeenCalledTimes(1);
    expect(value.onHostedChange).toHaveBeenLastCalledWith(true);

    await unmount();

    expect(value.onHostedChange).toHaveBeenCalledTimes(2);
    expect(value.onHostedChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps reporting once when the title or the scroll state changes', async () => {
    const onHostedChange = jest.fn();
    const { rerender } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('A long title', { onHostedChange })}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );

    await rerender(
      <LargeTitleHeadingContext.Provider
        value={headingValue('Another title', { onHostedChange, scrolled: true })}
      >
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );

    expect(onHostedChange.mock.calls).toEqual([[true]]);
  });

  it('records where its bottom edge sits: its height below the content padding', async () => {
    const value = headingValue('A long title');
    const { getByTestId } = await render(
      <LargeTitleHeadingContext.Provider value={value}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );

    await fireEvent(getByTestId('large-title-heading'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 343, height: 82 } },
    });

    expect(value.headingBottom.current).toBe(82 + darkTheme.spacing(4));
  });
});

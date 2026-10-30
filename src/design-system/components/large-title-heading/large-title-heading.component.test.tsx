import { StyleSheet } from 'react-native';
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
  inRow: false,
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

  // A one-word title never breaks mid-word: it shrinks on one line down to 0.7 (the pie legend
  // pattern); a title of several words wraps by word instead.
  it('shrinks a one-word title on one line, down to 0.7', async () => {
    const { getByRole } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('Налаштування')}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );
    const title = getByRole('header');

    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.adjustsFontSizeToFit).toBe(true);
    expect(title.props.minimumFontScale).toBe(0.7);
  });

  it('lets a title of several words wrap, with no shrinking', async () => {
    const { getByRole } = await render(
      <LargeTitleHeadingContext.Provider value={headingValue('Transaction templates')}>
        <LargeTitleHeading />
      </LargeTitleHeadingContext.Provider>,
    );
    const title = getByRole('header');

    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.adjustsFontSizeToFit).toBeFalsy();
    expect(title.props.minimumFontScale).toBeUndefined();
  });

  describe('in the bar row', () => {
    const renderHeading = (inRow: boolean) =>
      render(
        <LargeTitleHeadingContext.Provider value={headingValue('Statistics', { inRow })}>
          <LargeTitleHeading />
        </LargeTitleHeadingContext.Provider>,
      );

    it('takes no layout room and lays the title over the row, level with the right pane', async () => {
      const { getByTestId } = await renderHeading(true);
      const heading = StyleSheet.flatten(getByTestId('large-title-heading').props.style);
      const slot = StyleSheet.flatten(getByTestId('large-title-heading').parent?.props.style);

      expect(slot.height).toBe(0);
      expect(heading.position).toBe('absolute');
      expect(heading.top).toBeLessThan(0);
      expect(heading.left).toBe(0);
      expect(heading.right).toBe(0);
    });

    it('keeps the title in the flow of the content when it is not in the row', async () => {
      const { getByTestId } = await renderHeading(false);
      const heading = StyleSheet.flatten(getByTestId('large-title-heading').props.style);

      expect(heading.position).toBeUndefined();
      expect(heading.marginBottom).toBe(darkTheme.spacing(4));
    });
  });
});

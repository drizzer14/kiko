import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import '../../../design-system/unistyles';
import CategoryField from './category-field.component';

// The element type RNTL's own queries return (its bundled test-renderer
// TestInstance), derived from the query signature so no react-test-renderer
// dependency is imported just for the annotation.
type QueryNode = ReturnType<RenderResult['getByRole']>;

const OPTIONS = [
  { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#112233' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife', color: '#445566' },
];

// Feeds a row's onLayout a synthetic vertical offset, exactly as the native
// layout pass would once the sheet mounts (react-test-renderer never dispatches
// a real layout event, so a test must seed the offset map itself). The handler
// only writes to a ref (no React state), so it is invoked directly rather than
// through fireEvent — two synthetic `fireEvent(node, 'layout')` calls in one
// test leave React 19's concurrent act environment dirty and break the next
// render.
const emitRowLayout = (row: QueryNode, y: number): void => {
  row.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 320, height: 48 } } });
};

// The mocked SFSymbolView (jest/setup.js maps react-native-nitro-sfsymbols to a
// plain View) forwards `name` + `tintColor` as host props, so a glyph's native
// tint is read off the host node carrying that symbol name.
const glyphTint = (utils: RenderResult, name: string): string | undefined =>
  utils.root?.queryAll((node) => node.props.name === name).at(0)?.props.tintColor;

// Every native tintColor carried by a glyph with the given symbol name, in tree
// order. Used where a symbol renders more than once (e.g. 'cart' appears both in
// the collapsed field and in its selected sheet row).
const glyphTints = (utils: RenderResult, name: string): (string | undefined)[] =>
  (utils.root?.queryAll((node) => node.props.name === name) ?? []).map(
    (node) => node.props.tintColor,
  );

describe('CategoryField', () => {
  it('shows a placeholder in the field while nothing is selected', async () => {
    const { getByText } = await render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={jest.fn()} />,
    );

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Select category')).toBeTruthy();
  });

  it('shows the selected category title in the field', async () => {
    const { getByText, queryByText } = await render(
      <CategoryField
        label="Category"
        options={OPTIONS}
        selectedKey="groceries"
        onSelect={jest.fn()}
      />,
    );

    // The field reflects the current selection; the sheet is closed, so the
    // other options are not mounted yet.
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Dining')).toBeNull();
  });

  it('opens a bottom sheet listing every category when the field is tapped', async () => {
    const { getByLabelText, getByText } = await render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={jest.fn()} />,
    );

    await fireEvent.press(getByLabelText('Category'));

    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Dining')).toBeTruthy();
  });

  it('reports the picked category key and closes the sheet', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText, queryByText } = await render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={onSelect} />,
    );

    await fireEvent.press(getByLabelText('Category'));
    await fireEvent.press(getByText('Dining'));

    expect(onSelect).toHaveBeenCalledWith('dining');
    // Selecting a row closes the sheet: with no selectedKey change from the
    // parent the option rows unmount, leaving only the field's placeholder.
    expect(queryByText('Groceries')).toBeNull();
  });

  it('tints the collapsed field glyph with the selected category color', async () => {
    const utils = await render(
      <CategoryField
        label="Category"
        options={OPTIONS}
        selectedKey="groceries"
        onSelect={jest.fn()}
      />,
    );

    // The field's SF Symbol carries the picked category's own color as its
    // native tintColor, not a flat tone.
    expect(glyphTint(utils, 'cart')).toBe('#112233');
  });

  it('tints each option row glyph with that category color', async () => {
    const utils = await render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={jest.fn()} />,
    );

    await fireEvent.press(utils.getByLabelText('Category'));

    // Every row's glyph reads in its own category color — including the icons
    // that used to render with a flat textSecondary/textPrimary tone.
    expect(glyphTint(utils, 'cart')).toBe('#112233');
    expect(glyphTint(utils, 'fork.knife')).toBe('#445566');
  });

  it('tints the selected row glyph white so it reads on the accent fill', async () => {
    const utils = await render(
      <CategoryField
        label="Category"
        options={OPTIONS}
        selectedKey="groceries"
        onSelect={jest.fn()}
      />,
    );

    await fireEvent.press(utils.getByLabelText('Category'));

    // 'cart' renders twice while the sheet is open: the collapsed field keeps
    // the category color, and the selected row now paints white
    // (theme.colors.textPrimary) to match its checkmark on the accent fill.
    expect(glyphTints(utils, 'cart')).toContain('#FFFFFF');
    // The unselected 'Dining' row still carries its own category color.
    expect(glyphTint(utils, 'fork.knife')).toBe('#445566');
  });

  it('renders the option rows inside a vertical scroll container', async () => {
    const utils = await render(
      <CategoryField label="Category" options={OPTIONS} selectedKey={null} onSelect={jest.fn()} />,
    );

    await fireEvent.press(utils.getByLabelText('Category'));

    // The rows live inside a ScrollView (mirrors the icon picker) so a long
    // category list scrolls instead of overflowing the capped sheet.
    const scroll = utils.root
      ?.queryAll((node) => node.props.showsVerticalScrollIndicator === false)
      .at(0);
    expect(scroll).toBeTruthy();
  });

  it('marks the currently selected row as selected for accessibility', async () => {
    const { getByLabelText, getByRole } = await render(
      <CategoryField
        label="Category"
        options={OPTIONS}
        selectedKey="groceries"
        onSelect={jest.fn()}
      />,
    );

    await fireEvent.press(getByLabelText('Category'));

    const groceriesRow = getByRole('button', { name: 'Groceries' });
    expect(groceriesRow.props.accessibilityState.selected).toBe(true);
    const diningRow = getByRole('button', { name: 'Dining' });
    expect(diningRow.props.accessibilityState.selected).toBe(false);
  });

  // NOTE ON TEST ORDER: the one case that actually scrolls (calls the
  // ScrollView ref's `scrollTo`) is placed LAST. Invoking that imperative host
  // method — even mocked — inside a manually-run frame leaves React 19's
  // concurrent test-act environment dirty, which breaks the *next* test that
  // opens the sheet. The no-scroll cases never call `scrollTo`, so they run
  // first and safely; the scrolling case runs last with nothing after it.
  describe('scrolls the selected row into view on open', () => {
    let scrollToSpy: jest.SpyInstance;
    let frames: FrameRequestCallback[];

    beforeEach(() => {
      scrollToSpy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
      // Capture the queued scroll frame instead of running it, so a test can
      // seed the row offsets (emitRowLayout) before flushing it — mirroring the
      // real order: mount, layout, then the deferred scroll.
      frames = [];
      jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const flushFrames = (): void => {
      for (const frame of frames) {
        frame(0);
      }
    };

    it('stays at the top when nothing is selected', async () => {
      const utils = await render(
        <CategoryField
          label="Category"
          options={OPTIONS}
          selectedKey={null}
          onSelect={jest.fn()}
        />,
      );

      await fireEvent.press(utils.getByLabelText('Category'));
      flushFrames();

      // No selection means no target offset — the list is left at the top.
      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('stays at the top when the selected row is already the first row', async () => {
      const utils = await render(
        <CategoryField
          label="Category"
          options={OPTIONS}
          selectedKey="groceries"
          onSelect={jest.fn()}
        />,
      );

      await fireEvent.press(utils.getByLabelText('Category'));

      // The selected row's offset is 0 (top): there is nothing to scroll to.
      emitRowLayout(utils.getByRole('button', { name: 'Groceries' }), 0);
      flushFrames();

      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('scrolls to the selected row offset when the sheet opens', async () => {
      const utils = await render(
        <CategoryField
          label="Category"
          options={OPTIONS}
          selectedKey="dining"
          onSelect={jest.fn()}
        />,
      );

      await fireEvent.press(utils.getByLabelText('Category'));

      // The layout pass records the selected 'Dining' row's vertical offset,
      // which sits below the first row.
      emitRowLayout(utils.getByRole('button', { name: 'Dining' }), 48);
      flushFrames();

      // The deferred frame reads the offset map and jumps the list straight to
      // the selected row, so the sheet appears already scrolled to it.
      expect(scrollToSpy).toHaveBeenCalledWith({ y: 48, animated: false });
    });
  });
});

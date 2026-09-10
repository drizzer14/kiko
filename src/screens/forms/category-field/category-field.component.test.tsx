import { act, fireEvent, type RenderResult, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

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

// Every case renders the same field over the shared OPTIONS and label; they
// differ only by which key starts selected (and, where a test asserts the
// callback, the onSelect spy). Extracting the JSX keeps each test to its own
// arrange/act/assert without cloning the render block.
const renderCategoryField = (
  selectedKey: string | null,
  onSelect: (key: string) => void = jest.fn(),
): Promise<RenderResult> =>
  render(
    <CategoryField
      label="Category"
      options={OPTIONS}
      selectedKey={selectedKey}
      onSelect={onSelect}
    />,
  );

describe('CategoryField', () => {
  it('shows a placeholder in the field while nothing is selected', async () => {
    const { getByText } = await renderCategoryField(null);

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Select category')).toBeTruthy();
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <CategoryField
        label="Category"
        options={OPTIONS}
        selectedKey={null}
        onSelect={jest.fn()}
        required
      />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows the selected category title in the field', async () => {
    const { getByText, queryByText } = await renderCategoryField('groceries');

    // The field reflects the current selection; the sheet is closed, so the
    // other options are not mounted yet.
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Dining')).toBeNull();
  });

  it('opens a bottom sheet listing every category when the field is tapped', async () => {
    const { getByLabelText, getByText } = await renderCategoryField(null);

    await fireEvent.press(getByLabelText('Category'));

    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Dining')).toBeTruthy();
  });

  it('reports the picked category key and closes the sheet', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText, queryByText } = await renderCategoryField(null, onSelect);

    await fireEvent.press(getByLabelText('Category'));
    await fireEvent.press(getByText('Dining'));

    expect(onSelect).toHaveBeenCalledWith('dining');
    // Selecting a row closes the sheet: with no selectedKey change from the
    // parent the option rows unmount, leaving only the field's placeholder.
    expect(queryByText('Groceries')).toBeNull();
  });

  it('tints the collapsed field glyph with the selected category color', async () => {
    const utils = await renderCategoryField('groceries');

    // The field's SF Symbol carries the picked category's own color as its
    // native tintColor, not a flat tone.
    expect(glyphTint(utils, 'cart')).toBe('#112233');
  });

  it('tints each option row glyph with that category color', async () => {
    const utils = await renderCategoryField(null);

    await fireEvent.press(utils.getByLabelText('Category'));

    // Every row's glyph reads in its own category color — including the icons
    // that used to render with a flat textSecondary/textPrimary tone.
    expect(glyphTint(utils, 'cart')).toBe('#112233');
    expect(glyphTint(utils, 'fork.knife')).toBe('#445566');
  });

  it('tints the selected row glyph white so it reads on the accent fill', async () => {
    const utils = await renderCategoryField('groceries');

    await fireEvent.press(utils.getByLabelText('Category'));

    // 'cart' renders twice while the sheet is open: the collapsed field keeps
    // the category color, and the selected row now paints white
    // (theme.colors.onAccent) to match its checkmark on the accent fill.
    expect(glyphTints(utils, 'cart')).toContain('#FFFFFF');
    // The unselected 'Dining' row still carries its own category color.
    expect(glyphTint(utils, 'fork.knife')).toBe('#445566');
  });

  it('renders the option rows inside a vertical scroll container', async () => {
    const utils = await renderCategoryField(null);

    await fireEvent.press(utils.getByLabelText('Category'));

    // The rows live inside a ScrollView (mirrors the icon picker) so a long
    // category list scrolls instead of overflowing the capped sheet.
    const scroll = utils.root
      ?.queryAll((node) => node.props.showsVerticalScrollIndicator === false)
      .at(0);
    expect(scroll).toBeTruthy();
  });

  it('marks the currently selected row as selected for accessibility', async () => {
    const { getByLabelText, getByRole } = await renderCategoryField('groceries');

    await fireEvent.press(getByLabelText('Category'));

    const groceriesRow = getByRole('button', { name: 'Groceries' });
    expect(groceriesRow.props.accessibilityState.selected).toBe(true);
    const diningRow = getByRole('button', { name: 'Dining' });
    expect(diningRow.props.accessibilityState.selected).toBe(false);
  });

  // NOTE ON TEST ORDER: the cases that actually scroll (call the ScrollView
  // ref's `scrollTo`) are placed LAST. Invoking that imperative host method —
  // even mocked — leaves React 19's concurrent test-act environment dirty,
  // which breaks the *next* test that opens the sheet. The no-scroll cases
  // never call `scrollTo`, so they run first and safely; the scrolling cases
  // run last with nothing after them.
  //
  // The scroll-to-selected is driven off the inner ScrollView's REAL
  // measurement signal (`onContentSizeChange`, fired once the content size is
  // finalized) rather than a fixed single `requestAnimationFrame` defer, so it
  // lands the row regardless of how many frames the heavier BottomSheet takes
  // to finalize layout. Each test therefore records the row offsets
  // (`emitRowLayout`) and THEN fires the content-size signal — the real order:
  // mount, per-row layout, content-size finalization.
  describe('scrolls the selected row into view on open', () => {
    let scrollToSpy: jest.SpyInstance;

    beforeEach(() => {
      scrollToSpy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Fires the inner ScrollView's onContentSizeChange — the moment its content
    // size is finalized, after the rows have laid out. Only that ScrollView
    // carries `showsVerticalScrollIndicator === false` (the sheet runs
    // `scrollable={false}`, so BottomSheet mounts no ScrollView of its own).
    const emitContentSizeChange = (utils: RenderResult, height = 200): void => {
      const scroll = utils.root
        ?.queryAll((node) => node.props.showsVerticalScrollIndicator === false)
        .at(0);
      scroll?.props.onContentSizeChange(320, height);
    };

    it('stays at the top when nothing is selected', async () => {
      const utils = await renderCategoryField(null);

      await fireEvent.press(utils.getByLabelText('Category'));
      emitContentSizeChange(utils);

      // No selection means no target offset — the list is left at the top even
      // once the content has been measured.
      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('stays at the top when the selected row is already the first row', async () => {
      const utils = await renderCategoryField('groceries');

      await fireEvent.press(utils.getByLabelText('Category'));

      // The selected row's offset is 0 (top): there is nothing to scroll to,
      // even after the content-size signal fires.
      emitRowLayout(utils.getByRole('button', { name: 'Groceries' }), 0);
      emitContentSizeChange(utils);

      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('scrolls to the selected row once its content size is measured', async () => {
      const utils = await renderCategoryField('dining');

      await fireEvent.press(utils.getByLabelText('Category'));

      // The layout pass records the selected 'Dining' row's vertical offset
      // (below the first row) BEFORE the content-size signal fires.
      emitRowLayout(utils.getByRole('button', { name: 'Dining' }), 48);
      emitContentSizeChange(utils);

      // The measured content-size signal reads the offset map and jumps the
      // list straight to the selected row, so the sheet appears already
      // scrolled to it — no matter how late the sheet finalized its layout.
      expect(scrollToSpy).toHaveBeenCalledWith({ y: 48, animated: false });
    });

    it('scrolls exactly once per open even if the content size settles twice', async () => {
      const utils = await renderCategoryField('dining');

      await fireEvent.press(utils.getByLabelText('Category'));
      // The selected row's onLayout records its offset and performs the single
      // jump. Clear the shared prototype spy right after — an awaited press can
      // flush a prior test's leaked ScrollView.scrollTo into this same spy, and
      // the count below must measure only what the synchronous signals below do.
      emitRowLayout(utils.getByRole('button', { name: 'Dining' }), 48);
      scrollToSpy.mockClear();

      // The content size can settle more than once (a wrapped title, a late
      // measurement pass). The one-shot guard keeps the jump consumed, so these
      // repeat signals never re-scroll and a manual scroll is never yanked back.
      emitContentSizeChange(utils);
      emitContentSizeChange(utils);

      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('re-arms the scroll when the sheet closes and reopens', async () => {
      const utils = await renderCategoryField('dining');

      // First open: measure and jump to the selected row.
      await fireEvent.press(utils.getByLabelText('Category'));
      emitRowLayout(utils.getByRole('button', { name: 'Dining' }), 48);
      emitContentSizeChange(utils);
      expect(scrollToSpy).toHaveBeenCalledWith({ y: 48, animated: false });

      // Picking a row closes the sheet (onSelect leaves the selection intact),
      // then reopen it.
      await fireEvent.press(utils.getByRole('button', { name: 'Dining' }));
      await fireEvent.press(utils.getByLabelText('Category'));

      // Clear the spy AFTER the awaited presses (which can flush leaked scrolls
      // into the shared prototype spy) so the count measures only the reopen's
      // own synchronous re-measure.
      scrollToSpy.mockClear();
      emitRowLayout(utils.getByRole('button', { name: 'Dining' }), 48);
      emitContentSizeChange(utils);

      // The one-shot guard re-armed on close, so the reopen jumps to the
      // selection again instead of opening at the top.
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSpy).toHaveBeenCalledWith({ y: 48, animated: false });
    });
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('shows the empty-selection placeholder from the Ukrainian catalog', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByText, queryByText } = await renderCategoryField(null);

      expect(getByText('Оберіть категорію')).toBeTruthy();
      expect(queryByText('Select category')).toBeNull();
    });
  });
});

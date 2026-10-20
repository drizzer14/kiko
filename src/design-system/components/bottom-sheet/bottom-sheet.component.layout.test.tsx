import { StyleSheet, Text } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, HorizontalSizeClass, LayoutMode } from '@kiko/display-regions';

import '@kiko/design-system/unistyles';

import BottomSheet from '.';

const mockUseLayoutMode = jest.fn((): LayoutMode => 'single');
const mockUseFoldRegion = jest.fn((): FoldRegion => null);
const mockUseDisplayRegions = jest.fn((): { horizontalSizeClass: HorizontalSizeClass } => ({
  horizontalSizeClass: 'compact',
}));
jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useFoldRegion: () => mockUseFoldRegion(),
  useDisplayRegions: () => mockUseDisplayRegions(),
  useIsLargeWindow: () => false,
}));

const mockWindow = { width: 466, height: 678, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const SHEET_TEST_ID = 'sheet-card';
const BACKDROP_TEST_ID = 'sheet-backdrop';
const FOLD_GAP = 24;

const showWindow = (width: number, height: number) => {
  mockWindow.width = width;
  mockWindow.height = height;
};

const renderSheet = (maxHeight?: number) =>
  render(
    <BottomSheet
      visible
      onDismiss={jest.fn()}
      testID={SHEET_TEST_ID}
      backdropTestID={BACKDROP_TEST_ID}
      maxHeight={maxHeight}
    >
      <Text>sheet body</Text>
    </BottomSheet>,
  );

const cardStyle = () => StyleSheet.flatten(screen.getByTestId(SHEET_TEST_ID).props.style);

describe('BottomSheet on a two-pane display', () => {
  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('single');
    mockUseFoldRegion.mockReturnValue(null);
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'compact' });
    showWindow(466, 678);
  });

  it('keeps the card full width on a single compact window', async () => {
    await renderSheet();

    expect(cardStyle().width).toBeUndefined();
    expect(cardStyle().marginLeft).toBeUndefined();
    expect(cardStyle().maxHeight).toBe(678 * 0.66);
  });

  it('narrows the card to the sheet width and centres it on a single regular window', async () => {
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    showWindow(720, 500);
    await renderSheet();

    expect(cardStyle().width).toBe(darkTheme.layout.sheetMaxWidth);
    expect(cardStyle().marginLeft).toBe((720 - darkTheme.layout.sheetMaxWidth) / 2);
  });

  it('narrows the card to the sheet width and centres it on the inner display', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    showWindow(951, 669);
    await renderSheet();

    expect(cardStyle().width).toBe(darkTheme.layout.sheetMaxWidth);
    expect(cardStyle().marginLeft).toBe((951 - darkTheme.layout.sheetMaxWidth) / 2);
  });

  it('characterization: centres the card in the 1100 x 820 window, not in a wide pane', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    showWindow(1100, 820);
    await renderSheet();

    expect(cardStyle().width).toBe(darkTheme.layout.sheetMaxWidth);
    expect(cardStyle().marginLeft).toBe((1100 - 540) / 2);
  });

  it('characterization: a folded 1100 pt window uses the fold primary for the card', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    mockUseFoldRegion.mockReturnValue({ x: 400, y: 0, width: FOLD_GAP, height: 820 });
    showWindow(1100, 820);
    await renderSheet();

    expect(cardStyle().marginLeft).toBe(400 + FOLD_GAP + (1100 - 424 - 540) / 2);
  });

  it('centres the card in a portrait inner display too', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    showWindow(669, 951);
    await renderSheet();

    expect(cardStyle().width).toBe(540);
    expect(cardStyle().marginLeft).toBe((669 - 540) / 2);
  });

  it('leaves the dismiss scrim full-bleed', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    showWindow(951, 669);
    await renderSheet();

    expect(StyleSheet.flatten(screen.getByTestId(BACKDROP_TEST_ID).props.style)).toEqual({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
  });

  it('moves the card inside the right pane in a book posture', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseFoldRegion.mockReturnValue({ x: 463, y: 0, width: FOLD_GAP, height: 669 });
    showWindow(951, 669);
    await renderSheet();

    expect(cardStyle().marginLeft).toBeGreaterThanOrEqual(463 + FOLD_GAP);
    expect(cardStyle().marginLeft + cardStyle().width).toBeLessThanOrEqual(951);
  });

  it('keeps the card under the fold in a tabletop posture', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    mockUseFoldRegion.mockReturnValue({ x: 0, y: 463, width: 669, height: FOLD_GAP });
    showWindow(669, 951);
    await renderSheet();

    expect(cardStyle().maxHeight).toBe(951 - (463 + FOLD_GAP));
  });

  it('lets a tighter call-site maxHeight win over the tabletop cap', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    mockUseFoldRegion.mockReturnValue({ x: 0, y: 463, width: 669, height: FOLD_GAP });
    showWindow(669, 951);
    await renderSheet(200);

    expect(cardStyle().maxHeight).toBe(200);
  });

  it('keeps the 66% cap on a flat portrait inner display', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    showWindow(669, 951);
    await renderSheet();

    expect(cardStyle().maxHeight).toBe(951 * 0.66);
  });
});

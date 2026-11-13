import type { RenderResult } from '@testing-library/react-native';

import type { RenderedElement } from './rendered-element';

/**
 * Feeds a row's `onLayout` a synthetic vertical offset, as the native layout pass would once a
 * sheet mounts (react-test-renderer never dispatches one). The handler is called directly, not
 * through `fireEvent`: two `fireEvent(node, 'layout')` calls in one test leave React 19's
 * concurrent act environment dirty and break the next render. A row with no `onLayout` is a
 * no-op, so a test that expects a scroll fails on that assertion rather than on a TypeError.
 */
export const emitRowLayout = (row: RenderedElement, y: number): void => {
  row.props.onLayout?.({ nativeEvent: { layout: { x: 0, y, width: 320, height: 48 } } });
};

/**
 * Fires `onContentSizeChange` of the sheet's own scroll view (`${testID}-sheet-scroll`), the
 * moment its content size is finalized after the rows have laid out. A sheet that forwards no
 * handler is a no-op, for the same reason as above.
 */
export const emitSheetContentSize = (
  utils: Pick<RenderResult, 'getByTestId'>,
  testID: string,
  height = 200,
): void => {
  utils.getByTestId(`${testID}-sheet-scroll`).props.onContentSizeChange?.(320, height);
};

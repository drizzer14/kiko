import { createContext, type RefObject } from 'react';

export type LargeTitleHeadingValue = {
  title: string;
  // Whether the title fits one line and shows in the bar's row, in the left pane beside a side bar:
  // the heading is then laid over the row, takes no layout room, and nothing is ever reported
  // back or shown in the bar. A title that does not fit is never in the row.
  inRow?: boolean;
  // Whether the heading has scrolled up under the navigation bar, which then shows the title.
  scrolled: boolean;
  // Where the heading's bottom edge sits in the scroll content, in points. The heading writes it
  // once it is laid out; the scroll handler reads it on every scroll event.
  headingBottom: RefObject<number>;
  // Reports whether the heading has scrolled up under the navigation bar.
  onScrolledChange: (scrolled: boolean) => void;
  // Reports whether a screen renders the heading. The layout moves the title out of the bar only
  // once the heading is on screen, so a screen that never renders it keeps its native title. Keep
  // the callback's identity stable: the heading re-reports whenever it changes.
  onHostedChange: (hosted: boolean) => void;
};

/**
 * Set by the navigator's fitting-large-title layout only while a screen's title does not fit
 * one line of the native large title. `undefined` means the native large title shows the title
 * and the screen renders no heading.
 */
export const LargeTitleHeadingContext = createContext<LargeTitleHeadingValue | undefined>(
  undefined,
);

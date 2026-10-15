import { createContext, type RefObject } from 'react';

export type LargeTitleHeadingValue = {
  title: string;
  // Where the heading's bottom edge sits in the scroll content, in points. The heading writes it
  // once it is laid out; the scroll handler reads it on every scroll event.
  headingBottom: RefObject<number>;
  // Reports whether the heading has scrolled up under the navigation bar.
  onScrolledChange: (scrolled: boolean) => void;
};

/**
 * Set by the navigator's fitting-large-title layout only while a screen's title does not fit
 * one line of the native large title. `undefined` means the native large title shows the title
 * and the screen renders no heading.
 */
export const LargeTitleHeadingContext = createContext<LargeTitleHeadingValue | undefined>(
  undefined,
);

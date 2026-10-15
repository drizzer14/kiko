import { type FC, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LargeTitleHeadingContext } from '@kiko/design-system/components/large-title-heading';

import { largeTitleHeadingOptions, largeTitleRestoredOptions } from '../large-title-screen-options';

import { useTitleFit } from './use-title-fit';
import type { FittingLargeTitleProps } from './fitting-large-title.props';

/**
 * Keeps a screen's title readable in full. A title that fits one line of the native large title
 * stays the native large title. A title that does not fit switches the bar to an inline bar and
 * hands the full title to the screen as a wrapping heading (`LargeTitleHeadingContext`), which
 * the screen renders as its first scroll content. It wraps the screen's content only: the
 * native header and the safe areas are never wrapped.
 */
const FittingLargeTitle: FC<FittingLargeTitleProps> = ({ navigation, options, children }) => {
  const title = options.title ?? '';
  const { fits, measurer } = useTitleFit(title);
  const [scrolled, setScrolled] = useState(false);
  const headingBottom = useRef(0);
  // Whether this layout has switched the bar to the heading look. Its own override turns
  // `headerLargeTitle` off, so the merged options alone cannot say the screen had a large title.
  const switched = useRef(false);
  const eligible =
    options.headerShown !== false &&
    title !== '' &&
    (options.headerLargeTitle === true || switched.current);
  const headingMode = eligible && !fits;

  useLayoutEffect(() => {
    if (headingMode) {
      switched.current = true;
      navigation.setOptions(largeTitleHeadingOptions(title, scrolled));

      return;
    }

    if (switched.current) {
      switched.current = false;
      setScrolled(false);
      navigation.setOptions(largeTitleRestoredOptions);
    }
  }, [headingMode, title, scrolled, navigation]);

  const heading = useMemo(
    () => (headingMode ? { title, headingBottom, onScrolledChange: setScrolled } : undefined),
    [headingMode, title],
  );

  return (
    <LargeTitleHeadingContext.Provider value={heading}>
      {children}

      {eligible ? measurer : null}
    </LargeTitleHeadingContext.Provider>
  );
};

export default FittingLargeTitle;

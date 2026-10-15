import { LargeTitleHeadingContext } from '@kiko/design-system/components/large-title-heading';
import { type FC, type ReactElement, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { largeTitleHeadingOptions, largeTitleRestoredOptions } from '../large-title-screen-options';

import { useTitleFit } from './use-title-fit';
import type { FittingLargeTitleProps } from './fitting-large-title.props';

/**
 * Keeps a screen's title readable in full. A title that fits one line of the native large title
 * stays the native large title. A title that does not fit hands the full title to the screen as
 * a wrapping heading (`LargeTitleHeadingContext`), which the screen renders as its first scroll
 * content; once the heading is on screen, the bar switches to the large-title look with no
 * large title. A screen that never renders the heading keeps its native bar. It wraps the
 * screen's content only: the native header and the safe areas are never wrapped.
 */
const FittingLargeTitle: FC<FittingLargeTitleProps> = ({ navigation, options, children }) => {
  const title = options.title ?? '';
  const { fits, measurer } = useTitleFit(title);
  const [scrolled, setScrolled] = useState(false);
  const [hosted, setHosted] = useState(false);
  const headingBottom = useRef(0);
  // Whether this layout has switched the bar to the heading look. Its own override turns
  // `headerLargeTitle` off, so the merged options alone cannot say the screen had a large title.
  const switched = useRef(false);
  // The screen's own bar options, which the restore brings back. Once switched, the merged options
  // carry the heading look's values, so they are read only while the bar has not switched.
  const ownOptions = useRef(options);
  const eligible =
    options.headerShown !== false &&
    title !== '' &&
    (options.headerLargeTitle === true || switched.current);
  const headingMode = eligible && !fits;
  // The bar loses its title only while the heading is on screen to show it instead.
  const headingShown = headingMode && hosted;

  // Runs every commit, before the effect below sets the heading look, so the options it reads are
  // the screen's own.
  useLayoutEffect(() => {
    if (!switched.current) {
      ownOptions.current = options;
    }
  });

  useLayoutEffect(() => {
    if (headingShown) {
      switched.current = true;
      navigation.setOptions(largeTitleHeadingOptions(title, scrolled));

      return;
    }

    if (switched.current) {
      switched.current = false;
      setScrolled(false);
      navigation.setOptions(largeTitleRestoredOptions(ownOptions.current));
    }
  }, [headingShown, title, scrolled, navigation]);

  const heading = useMemo(
    () =>
      headingMode
        ? {
            title,
            scrolled,
            headingBottom,
            onScrolledChange: setScrolled,
            onHostedChange: setHosted,
          }
        : undefined,
    [headingMode, title, scrolled],
  );

  return (
    <LargeTitleHeadingContext.Provider value={heading}>
      {children}

      {eligible ? measurer : null}
    </LargeTitleHeadingContext.Provider>
  );
};

/**
 * The `screenLayout` of every native stack that shows a large title. React Navigation calls it
 * once per screen with the screen's merged options, so a title set by `options.title` or by
 * `navigation.setOptions` is covered with no screen passing it twice.
 */
export const fittingLargeTitleLayout = ({
  navigation,
  options,
  children,
}: FittingLargeTitleProps): ReactElement => {
  return (
    <FittingLargeTitle navigation={navigation} options={options}>
      {children}
    </FittingLargeTitle>
  );
};

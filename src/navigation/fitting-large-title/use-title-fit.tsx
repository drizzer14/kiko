import { useWindowDimensions } from 'react-native';
import { type ReactElement, useState } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { usePaneWidth } from '@kiko/design-system/pane-context';
import { useContentMargin } from '@kiko/design-system/components/screen';

import TitleMeasurer from './title-measurer';
import { estimatedTitleFits, nativeTitleLineWidth } from './title-fit';

type TitleFit = {
  fits: boolean;
  // The invisible element that measures the title; render it for the measurement to arrive.
  // `null` when there is no width to measure at.
  measurer: ReactElement | null;
};

type Measurement = { key: string; fits: boolean };

/**
 * Whether `title` fits one line of the native large title. The first render decides from a
 * cautious width estimate, so the first frame is already right in the clear cases; once the
 * rendered `measurer` has laid the title out, that measurement replaces the estimate. A
 * measurement belongs to one title at one width, so a new title or width falls back to the
 * estimate until it is measured.
 */
export const useTitleFit = (title: string): TitleFit => {
  const { width: windowWidth } = useWindowDimensions();
  const paneWidth = usePaneWidth();
  const { theme } = useUnistyles();
  const contentMargin = useContentMargin();
  const [measurement, setMeasurement] = useState<Measurement>();
  // A split window gives each pane its own header, so the pane's width is the line the title has;
  // the window is the line only where it is the screen. On a flat `columns` window a pane is half
  // the window, a `rows` pane is the window's whole width, and a fold sets its own widths. The
  // title is inset by the content's margin on both sides (`PaneStackView` tells the native stack
  // that margin where UIKit's own would differ).
  const availableWidth = (paneWidth ?? windowWidth) - 2 * contentMargin;
  const key = `${availableWidth}:${title}`;

  const fits =
    measurement?.key === key
      ? measurement.fits
      : estimatedTitleFits(title, availableWidth, theme.typography.largeTitle.fontSize);

  return {
    fits,
    // A width of nothing or less cannot lay a title out, so there is nothing to measure.
    measurer:
      availableWidth > 0 ? (
        <TitleMeasurer
          key={key}
          title={title}
          // A one-word title is laid out at its safe share of the line: a word wider than that
          // breaks mid-word here, as the native title does on a line narrower than ours.
          availableWidth={nativeTitleLineWidth(title, availableWidth)}
          onFitChange={(measuredFits) => setMeasurement({ key, fits: measuredFits })}
        />
      ) : null,
  };
};

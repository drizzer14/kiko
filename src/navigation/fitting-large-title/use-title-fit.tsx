import { useWindowDimensions } from 'react-native';
import { type ReactElement, useState } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { usePaneWidth } from '@kiko/design-system/pane-context';

import TitleMeasurer from './title-measurer';
import { estimatedTitleFits } from './title-fit';

// The native large title sits inside the same side margin as the screen's content.
const LARGE_TITLE_MARGIN_STEP = 4;

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
  const [measurement, setMeasurement] = useState<Measurement>();
  // A split window gives each pane its own header, so the pane's width is the line the title has;
  // the window is the line only where it is the screen. On a flat `columns` window a pane is half
  // the window, a `rows` pane is the window's whole width, and a fold sets its own widths.
  const availableWidth = (paneWidth ?? windowWidth) - 2 * theme.spacing(LARGE_TITLE_MARGIN_STEP);
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
          availableWidth={availableWidth}
          onFitChange={(measuredFits) => setMeasurement({ key, fits: measuredFits })}
        />
      ) : null,
  };
};

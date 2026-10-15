import type { ReactElement } from 'react';

import FittingLargeTitle from './fitting-large-title.component';
import type { FittingLargeTitleProps } from './fitting-large-title.props';

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

import type { FC } from 'react';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';

import Box from '../box';
import Text from '../text';

import type { ConvertedCaptionProps } from './converted-caption.props';

// The smaller base-currency figure under a total, the holding card's caption pattern. It renders
// nothing without a figure, so a caller passes `null` for "same currency" or "no rate yet"
// instead of guarding the element itself.
const ConvertedCaption: FC<ConvertedCaptionProps> = ({ money, testID }) =>
  money && (
    <Box testID={testID}>
      <Text variant="caption" tone="textSecondary">
        {formatMoney(money, activeLocale())}
      </Text>
    </Box>
  );

export default ConvertedCaption;

import { Pressable } from 'react-native';
import type { FC } from 'react';

import type { HoldingRow } from '../../../db/schema';
import { formatMoney } from '../../../currency/format';
import Box from '../../../design-system/components/box';
import Card from '../../../design-system/components/card';
import Text from '../../../design-system/components/text';
import { activeLocale } from '../../../i18n/active-locale';
import { canConvert } from '../../../rates/net-worth-view';
import type { Currency } from '../../../currency/currency';
import { holdingValue } from '../../../holdings/holding-value';
import { convert, type RateTable } from '../../../rates/conversion';
import MoneyText from '../../../design-system/components/money-text';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import EntityIconTile from '../../../design-system/components/entity-icon-tile';

import { styles } from './holding-card.styles';

// One holding rendered as a wide row card, mirroring the accounts-list card: its
// icon + name on the left, its computed value on the right. A plain tap opens the
// holding detail. Reordering and delete are owned by the enclosing 1-column grid
// and `CardContextMenu`: a hold that moves activates a drag (reorder), and a hold
// that stays still opens the deep-press (haptic) delete menu, so this card
// intentionally carries no long-press handler of its own. The value is the
// holding's COMPUTED worth as of `now` (deposits/bonds accrue over time and carry
// a stored balance of 0), matching the account headline and the holding-detail
// page. A holding in a currency OTHER than the base (main) currency shows a
// smaller converted base-currency value beneath its own-currency value, so the
// user reads both figures; the account card already shows the base currency.
//
// This card used to carry a `settled`/`transitionEnd` remount workaround for a
// `GlassSurface` (Liquid Glass) one-shot-layout bug on this pushed route: the
// native glass locked its tint on the transient mid-slide frame. Now that this
// is the shared solid `Card` (a plain `View` fill, no native glass material at
// all — see `Card`'s own doc comment for why content no longer routes through
// Liquid Glass), that class of bug cannot recur here, so the workaround is
// gone with it.
const HoldingCard: FC<{
  holding: HoldingRow;
  now: number;
  baseCurrency: Currency;
  rateTable: RateTable;
  onOpen: () => void;
}> = ({ holding, now, baseCurrency, rateTable, onOpen }) => {
  const color = resolveEntityColor(holding.color, defaultHoldingColor[holding.type]);
  const value = holdingValue(holding, now);
  // The smaller base-currency figure below the value, shown ONLY for a holding
  // in a different currency that also has a cached rate to the base. `convert`
  // throws on a missing rate pair, so `canConvert` guards it — a currency with
  // no rate yet (e.g. BTC before the first sync) simply shows no second line.
  const convertedToBase =
    holding.currency !== baseCurrency && canConvert(holding.currency, baseCurrency, rateTable)
      ? convert(value, baseCurrency, rateTable)
      : null;

  return (
    <Card testID="holding-card" padding={4}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.row}>
        <Box direction="row" gap={3} style={styles.rowLead}>
          <EntityIconTile
            name={holding.icon ?? holdingTypeSymbol[holding.type]}
            color={color}
            accessibilityLabel={`${holding.name} icon`}
          />
          <Text variant="body">{holding.name}</Text>
        </Box>

        <Box style={styles.valueColumn}>
          <MoneyText money={value} context="balance" />

          {convertedToBase && (
            <Box testID="holding-card-converted">
              <Text variant="caption" tone="textSecondary">
                {formatMoney(convertedToBase, activeLocale())}
              </Text>
            </Box>
          )}
        </Box>
      </Pressable>
    </Card>
  );
};

export default HoldingCard;

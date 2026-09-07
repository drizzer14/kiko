import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { type FC, useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { HoldingRow } from '../../../db/schema';
import { resolveColorScheme } from '../../../design-system/color-scheme';
import Box from '../../../design-system/components/box';
import GlassSurface from '../../../design-system/components/glass-surface';
import MoneyText from '../../../design-system/components/money-text';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { entityCardBackground, resolveEntityColor } from '../../../design-system/entity-tint';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { holdingValue } from '../../../holdings/holding-value';
import type { AccountsStackParamList } from '../../../navigation/types';

import { styles } from './holding-card.styles';

// One holding rendered as a wide row card, mirroring the accounts-list card: its
// icon + name on the left, its computed value on the right. A plain tap opens the
// holding detail. Reordering and delete are owned by the enclosing 1-column grid
// and `CardContextMenu`: a hold that moves activates a drag (reorder), and a hold
// that stays still opens the deep-press (haptic) delete menu, so this card
// intentionally carries no long-press handler of its own. The value is the
// holding's COMPUTED worth as of `now` (deposits/bonds accrue over time and carry
// a stored balance of 0), matching the account headline and the holding-detail
// page.
const HoldingCard: FC<{
  holding: HoldingRow;
  now: number;
  onOpen: () => void;
}> = ({ holding, now, onOpen }) => {
  const { rt } = useUnistyles();
  const scheme = resolveColorScheme(rt.themeName);
  const color = resolveEntityColor(
    holding.color,
    defaultHoldingColor(scheme)[holding.type],
    scheme,
  );

  // WHY: HoldingCard mounts on the AccountDetail *pushed* route, so its glass
  // first lays out mid-slide at PARTIAL width. The vendor LiquidGlassView
  // (`@callstack/liquid-glass`) applies its native UIGlassEffect EXACTLY ONCE,
  // on its first `layoutSubviews`, then locks — it never re-applies on a later
  // tintColor change or a settled layout. So that one-shot lands against the
  // transient mid-transition frame and the card's tint drifts. Account cards
  // don't suffer this: they live on the persistent tab root and lock on settled
  // geometry.
  //
  // FIX: hold `settled` false until the push slide-in finishes, then flip it
  // true. The native stack emits `transitionEnd` (with `closing: false`) when
  // the pushed screen finishes appearing — i.e. the card has reached its final
  // full-width geometry. Flipping `settled` swaps the GlassSurface `key`, which
  // unmounts the old native glass and mounts a fresh one, so its single, locking
  // `layoutSubviews` now happens at the settled, full-width size. Returning the
  // subscription's own unsubscribe cleans the listener up on unmount. If the
  // screen ever mounts with no transition (already settled), the event simply
  // never fires and the card stays on its initial glass — which in that case is
  // already laid out at full width, so no remount is needed.
  const navigation =
    useNavigation<NativeStackNavigationProp<AccountsStackParamList, 'AccountDetail'>>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e.data?.closing) {
        setSettled(true);
      }
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <GlassSurface
      key={settled ? 'settled' : 'initial'}
      testID="holding-card"
      padding={4}
      bordered
      tint={entityCardBackground(color, scheme)}
    >
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.row}>
        <Box direction="row" gap={3} style={styles.rowLead}>
          <SymbolIcon
            name={holding.icon ?? holdingTypeSymbol[holding.type]}
            color={color}
            accessibilityLabel={`${holding.name} icon`}
          />
          <Text variant="body">{holding.name}</Text>
        </Box>

        <MoneyText money={holdingValue(holding, now)} context="balance" />
      </Pressable>
    </GlassSurface>
  );
};

export default HoldingCard;

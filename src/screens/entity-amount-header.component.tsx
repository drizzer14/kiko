import type { FC, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Money } from '../currency/money';
import Box from '../design-system/components/box';
import MoneyText from '../design-system/components/money-text';
import type { MoneyTextContext } from '../design-system/components/money-text/money-text.props';
import Text from '../design-system/components/text';
import { styles } from './entity-amount-header.styles';

// The shared "headline amount" header for the account- and holding-detail
// screens: a heading-weight label ("Balance" / "Value") above a title-sized
// MoneyText amount. Both detail screens render through this so "Value" reads
// IDENTICALLY to "Balance" — same typography, layout, and spacing — instead
// of each screen hand-rolling its own label + MoneyText pair that quietly
// drifts from the other's (the round-2 design review finding this fixes).
//
// `icon` is an OPTIONAL trailing slot sharing a row with the "Balance"/"Value"
// LABEL specifically — not the amount below it, and not the vertical midpoint
// of the two-line label+amount column — so the entity's identity icon lines up
// at the same height as the label text (the nav title carries the name only,
// no icon). Nesting the label and the icon in their own row, separate from the
// amount, is what pins the icon's vertical center to the label's regardless of
// the icon's own size relative to the label's line height — see `styles.labelRow`.
// This component only exposes and styles the slot: it takes an already-built
// node (each detail screen passes an `EntityHeaderIcon`), never resolves the
// entity's own icon/color, so wiring that in is a single prop change at the
// call site, not a change here.
type EntityAmountHeaderProps = {
  // "Balance" (account-detail) or "Value" (holding-detail).
  label: string;
  money: Money;
  // Forwarded to `MoneyText` unchanged. Both screens' headline figure is a
  // snapshot of what's owned, not a gain, so this only needs overriding if a
  // future caller's headline figure is itself a movement.
  context?: MoneyTextContext;
  // Absent by default — a screen renders this header exactly as it does
  // today until a caller starts passing one.
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

const EntityAmountHeader: FC<EntityAmountHeaderProps> = ({
  label,
  money,
  context,
  icon,
  style,
}) => {
  return (
    <Box gap={1} style={style}>
      <Box direction="row" style={styles.labelRow}>
        <Text variant="heading">{label}</Text>
        {icon !== undefined && <Box style={styles.iconSlot}>{icon}</Box>}
      </Box>

      <MoneyText money={money} context={context} style={styles.amount} />
    </Box>
  );
};

export default EntityAmountHeader;

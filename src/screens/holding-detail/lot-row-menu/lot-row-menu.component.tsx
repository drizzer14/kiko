import type { FC } from 'react';
import { formatDate } from '@kiko/dates';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';

import type { LotRowMenuProps } from './lot-row-menu.props';

// A lot row is the one derived ledger row the user entered, so it edits and
// deletes through the long-press menu like a share change. A row has nothing
// to open on a tap, so Edit joins Delete. Delete is not offered while a later
// sale still needs the lot. Every other derived row stays bare.
const LotRowMenu: FC<LotRowMenuProps> = ({ entry, actions, children }) => {
  const { lotIndex } = entry;

  if (lotIndex === undefined || actions === undefined) {
    return <>{children}</>;
  }

  return (
    <CardContextMenu
      name={`${entry.label} ${formatDate(entry.time, { timeZone: 'UTC' })}`}
      deletable={actions.isRemovable(lotIndex)}
      onDelete={() => actions.remove(lotIndex)}
      onEdit={() => actions.edit(lotIndex)}
      liftOnHold
    >
      {children}
    </CardContextMenu>
  );
};

export default LotRowMenu;

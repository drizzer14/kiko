import type { FC } from 'react';

import SymbolIcon from '../../design-system/components/symbol';

// The entity's identity glyph as it appears beside the Balance/Value amount in
// `EntityAmountHeader`, built from the account's/holding's effective icon + color
// (see `accountIdentity`/`holdingIdentity` at each detail screen). Both detail
// screens render an identical icon here, so it lives in one component rather than
// duplicating the `SymbolIcon` markup — and each screen can pass it
// unconditionally: with no identity yet (the row's live query still loading) it
// renders nothing, so the screen body carries no extra branch for it.
const ENTITY_ICON_SIZE = 28;

const EntityHeaderIcon: FC<{ identity?: { icon: string; color: string } }> = ({ identity }) => {
  if (identity === undefined) {
    return null;
  }

  return (
    <SymbolIcon
      name={identity.icon}
      size={ENTITY_ICON_SIZE}
      color={identity.color}
      accessibilityLabel={`Icon ${identity.icon}`}
    />
  );
};

export default EntityHeaderIcon;

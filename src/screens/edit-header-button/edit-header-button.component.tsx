import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../../design-system/components/button';

// The header-right "Edit" affordance shared by the account- and holding-detail
// screens: the shared borderless (ghost) Button — compact and self-hugging,
// with a leading pencil glyph — wired via navigation.setOptions
// `headerRight` so it sits at the top-right, opposite the back button.
// Pressing it opens the entity's dedicated edit form. Reuses the shared
// Button rather than a hand-rolled nav-bar text control so its label and icon
// tint stay a single source of truth with every other button in the app,
// instead of a second, drifting definition — but `ghost`, not `secondary`: a
// header action reads as the standard iOS text-with-icon nav-bar control, not
// a filled gray pill (that would visually compete with the screen's actual
// buttons, e.g. "Sync now" / "Add holding").
const EditHeaderButton: FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="compact"
      fullWidth={false}
      icon="pencil"
      accessibilityLabel={t('common.edit')}
      onPress={onPress}
    >
      {t('common.edit')}
    </Button>
  );
};

export default EditHeaderButton;

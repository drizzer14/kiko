import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../button';

// The header-right Edit affordance shared by the account- and holding-detail
// screens, wired via navigation.setOptions (`headerRight`, or a `custom` entry
// in `unstable_headerRightItems` beside a native bar item). It reuses the
// shared Button so its glyph tint stays one source of truth with every other
// button — `ghost`, because a filled pill would compete with the screen's own
// actions. It is icon-only because the user asked for no visible "Edit" text
// beside the native bell symbol; the compact size keeps the 44pt target
// (44pt min height, 12pt padding either side of the 20pt glyph), and the
// accessibilityLabel keeps the spoken "Edit" for VoiceOver.
const EditHeaderButton: FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="compact"
      fullWidth={false}
      icon="pencil"
      testID="edit-header-button"
      accessibilityLabel={t('common.edit')}
      onPress={onPress}
    />
  );
};

export default EditHeaderButton;

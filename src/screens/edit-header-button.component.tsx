import type { FC } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

// The header-right "Edit" affordance shared by the account- and holding-detail
// screens: a plain accent-tinted text button (the iOS nav-bar convention),
// wired via navigation.setOptions `headerRight` so it sits at the top-right,
// opposite the back button. Pressing it opens the entity's dedicated edit form.
// A bare RN Text (not the design-system Text) because the accent tone is not a
// Text `tone` token and header buttons carry the system accent, matching iOS.
const EditHeaderButton: FC<{ onPress: () => void }> = ({ onPress }) => {
  const { theme } = useUnistyles();

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Edit" hitSlop={8} onPress={onPress}>
      <RNText style={{ color: theme.colors.accent, fontSize: theme.typography.body.fontSize }}>
        Edit
      </RNText>
    </Pressable>
  );
};

export default EditHeaderButton;

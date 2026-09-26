import type { FC } from 'react';
import { MONOBANK_API_ENDPOINT } from '@env';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable } from 'react-native';

import { styles } from '../account-detail.styles';
import Box from '../../../design-system/components/box';
import ClipboardTextField from '../clipboard-text-field';
import Text from '../../../design-system/components/text';

import type { MonobankTokenInputProps } from './monobank-token-input.props';

// The shared, presentational Monobank token-entry surface: the
// "Open api.monobank.ua" link, the token TextField, and its trailing paste-icon
// button (which reads the clipboard into the field). It owns NO Connect button,
// sync status, or Disconnect action — those are edit-surface-only concerns that
// stay with `MonobankConnectField`. Both the account-detail edit surface and the
// add-account create form consume this so the two entry surfaces stay identical
// rather than drifting as two hand-rolled copies.
const MonobankTokenInput: FC<MonobankTokenInputProps> = ({ value, onChangeText }) => {
  const { t } = useTranslation();

  const handleOpenMonobank = (): void => {
    Linking.openURL(`${MONOBANK_API_ENDPOINT}/`);
  };

  return (
    <Box gap={3}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('accountDetail.openMonobankLink')}
        onPress={handleOpenMonobank}
        style={styles.linkPressable}
      >
        <Text variant="body" tone="accent">
          {t('accountDetail.openMonobankLink')}
        </Text>
      </Pressable>

      <ClipboardTextField
        label={t('accountDetail.tokenLabel')}
        value={value}
        onChangeText={onChangeText}
        placeholder={t('accountDetail.monobankTokenPlaceholder')}
        pasteAccessibilityLabel={t('accountDetail.pasteFromClipboard')}
        secureTextEntry
      />

      {/* Guideline 5.6 data-handling disclosure: the token never leaves the
          device except straight to Monobank's own API. */}
      <Text variant="caption" tone="textSecondary">
        {t('accountDetail.monobankKeychainDisclosure')}
      </Text>
    </Box>
  );
};

export default MonobankTokenInput;

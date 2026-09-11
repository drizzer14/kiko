import Clipboard from '@react-native-clipboard/clipboard';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text as RNText } from 'react-native';

import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import TextField from '../../../design-system/components/text-field';
import { styles } from '../account-detail.styles';

import type { MonobankTokenInputProps } from './monobank-token-input.props';

const MONOBANK_API_URL = 'https://api.monobank.ua/';

// The shared, presentational Monobank token-entry surface: the
// "Open api.monobank.ua" link, the token TextField, and its trailing paste-icon
// button (which reads the clipboard into the field). It owns NO Save button,
// sync status, or Disconnect action — those are edit-surface-only concerns that
// stay with `MonobankTokenField`. Both the account-detail edit surface and the
// add-account create form consume this so the two entry surfaces stay identical
// rather than drifting as two hand-rolled copies.
const MonobankTokenInput: FC<MonobankTokenInputProps> = ({ value, onChangeText }) => {
  const { t } = useTranslation();

  const handleOpenMonobank = (): void => {
    Linking.openURL(MONOBANK_API_URL);
  };

  const handlePasteToken = (): void => {
    Clipboard.getString().then((clipboardValue) => {
      onChangeText(clipboardValue.trim());
    });
  };

  return (
    <Box gap={3}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('accountDetail.openMonobankLink')}
        onPress={handleOpenMonobank}
        style={styles.linkPressable}
      >
        <RNText style={styles.link}>{t('accountDetail.openMonobankLink')}</RNText>
      </Pressable>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.tokenLabel')}
            value={value}
            onChangeText={onChangeText}
            placeholder={t('accountDetail.monobankTokenPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountDetail.pasteFromClipboard')}
          onPress={handlePasteToken}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>
    </Box>
  );
};

export default MonobankTokenInput;

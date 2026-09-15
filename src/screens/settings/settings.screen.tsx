import type { FC } from 'react';
import { match } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native-unistyles';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { Linking, Pressable, type ScrollViewInstance } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import pkg from '../../../package.json';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Screen from '../../design-system/components/screen';
import type { SettingsStackParamList } from '../../navigation/types';
import GlassSurface from '../../design-system/components/glass-surface';
import CurrencyField from '../../design-system/components/currency-field';
import { type Currency, fiatCurrencyOptions } from '../../currency/currency';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';

import SettingsRow from './settings-row';

type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

const PRIVACY_POLICY_URL_EN = 'https://drizzer14.github.io/kiko/en.html';
const PRIVACY_POLICY_URL_UK = 'https://drizzer14.github.io/kiko';

// The privacy-policy link opens the page matching the CURRENT app language,
// not the device locale — mirrors `activeLocale()`'s uk/otherwise shape
// (`src/i18n/active-locale/active-locale.ts`).
const resolvePrivacyPolicyUrl = (language: string): string =>
  match(language)
    .with('uk', () => PRIVACY_POLICY_URL_UK)
    .otherwise(() => PRIVACY_POLICY_URL_EN);

const styles = StyleSheet.create((theme) => ({
  // Separates the footer from the cards Box above with a token gap, rather
  // than a raw pixel margin.
  footer: {
    marginTop: theme.spacing(4),
  },
  // Matches `monobank-token-input.component.tsx`'s `linkPressable`: the
  // tappable link hugs its own text width instead of stretching full-width.
  footerLink: {
    alignSelf: 'flex-start',
  },
}));

const SettingsScreen: FC<SettingsScreenProps> = ({ navigation }) => {
  // Re-tapping the Settings tab while already on it returns this scrolling page
  // to the top (the standard iOS active-tab re-tap), driven off the native tab
  // navigator's `tabPress`.
  const scrollRef = useAnimatedRef<ScrollViewInstance>();
  // The live `contentOffset.y`, so the hook can skip a redundant scroll.
  const scrollOffset = useScrollOffset(scrollRef);
  useScrollToTopOnTabPress(scrollRef, scrollOffset);

  const { t, i18n } = useTranslation();

  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectCurrency = (currency: Currency): void => {
    settingsRepo.setBaseCurrency(currency);
  };

  const handleOpenPrivacyPolicy = (): void => {
    Linking.openURL(resolvePrivacyPolicyUrl(i18n.language));
  };

  return (
    <Screen scroll scrollableRef={scrollRef}>
      {/* Each setting is its own GlassSurface card, mirroring the Accounts
          list — the Box gap gives the vertical space between cards. For now,
          if more settings appear that belong together they can be grouped back
          into a shared card; until then one-card-per-setting keeps them
          visually distinct. */}
      <Box gap={4}>
        {/* The System sub-page groups system-level preferences (Language, Color
            Scheme, Face ID) away from the finance settings below. It sits at the
            very top as a navigating row that pushes the System screen. */}
        <GlassSurface testID="settings-card-system" padding={3} transparent bloom>
          <SettingsRow
            testID="settings-row-system"
            icon="gearshape"
            label={t('settings.system')}
            onPress={() => navigation.navigate('System')}
          />
        </GlassSurface>

        {/* The base currency is FIAT-ONLY: it drives every net-worth conversion,
            so a crypto base (BTC) is not selectable here. The field reuses the
            shared searchable CurrencyField the account/holding forms use, its
            `options` restricted to `fiatCurrencyOptions`. It is wrapped in a
            SettingsRow so it carries the same leading icon + label framing as
            every other settings row; `hideLabel` suppresses CurrencyField's own
            inline caption so "Base Currency" is not shown twice, while the label
            still titles the picker sheet. */}
        <GlassSurface testID="settings-card-base-currency" padding={3} transparent bloom>
          <SettingsRow icon="hryvniasign.circle" label={t('settings.baseCurrency')}>
            <CurrencyField
              testID="settings-row-base-currency"
              label={t('settings.baseCurrency')}
              hideLabel
              selected={settings?.baseCurrency}
              onSelect={handleSelectCurrency}
              options={fiatCurrencyOptions}
            />
          </SettingsRow>
        </GlassSurface>

        <GlassSurface testID="settings-card-categories" padding={3} transparent bloom>
          <SettingsRow
            testID="settings-row-categories"
            icon="tag"
            label={t('settings.categories')}
            onPress={() => navigation.navigate('Categories')}
          />
        </GlassSurface>
      </Box>

      {/* App Store compliance footer: app name + version, copyright, and a
          Privacy Policy link — a sibling of the cards Box, not a fourth card,
          so it reads as page chrome rather than another setting. */}
      <Box gap={1} style={styles.footer}>
        <Text variant="caption" tone="textSecondary">
          {`${t('settings.footer.appName')} v${pkg.version}`}
        </Text>

        <Text variant="caption" tone="textSecondary">
          {`© ${new Date().getFullYear()} ${t('settings.footer.copyrightHolder')}`}
        </Text>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('settings.footer.privacyPolicy')}
          onPress={handleOpenPrivacyPolicy}
          style={styles.footerLink}
        >
          <Text variant="caption" tone="accent">
            {t('settings.footer.privacyPolicy')}
          </Text>
        </Pressable>
      </Box>
    </Screen>
  );
};

export default SettingsScreen;

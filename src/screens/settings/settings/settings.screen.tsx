import type { FC } from 'react';
import { match } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native-unistyles';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { Linking, Pressable, type ScrollViewInstance } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import pkg from '../../../../package.json';
import Box from '../../../design-system/components/box';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Screen from '../../../design-system/components/screen';
import type { SettingsStackParamList } from '../../../navigation/types';
import Card from '../../../design-system/components/card';
import CurrencyField from '../../../design-system/components/currency-field';
import { type Currency, fiatCurrencyOptions } from '../../../currency/currency';
import { useScrollToTopOnTabPress } from '../../../navigation/use-scroll-to-top-on-tab-press';

import SettingsRow from '../settings-row';

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

const styles = StyleSheet.create(() => ({
  // Centers the whole footer block (app name/version, copyright, Privacy
  // Policy link) horizontally, per review feedback. The block renders through
  // `Screen`'s pinned `footer` slot (outside the scrolling content), which
  // already supplies the vertical separation from the cards above and keeps
  // it pinned above the tab bar with no scrolling required.
  footer: {
    alignItems: 'center',
  },
  // Centers each footer line's text within the now-centered footer Box.
  footerText: {
    textAlign: 'center',
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
    <Screen
      scroll
      scrollableRef={scrollRef}
      footer={
        // App Store compliance footer: app name + version, copyright, and a
        // Privacy Policy link. It renders through the pinned `footer` slot so
        // it always stays visible just above the tab bar, never pushed below
        // the fold by the scrolling cards above it.
        <Box gap={1} style={styles.footer}>
          <Text variant="caption" tone="textSecondary" style={styles.footerText}>
            {`${t('settings.footer.appName')} v${pkg.version}`}
          </Text>

          <Text variant="caption" tone="textSecondary" style={styles.footerText}>
            {`© ${new Date().getFullYear()} ${t('settings.footer.copyrightHolder')}`}
          </Text>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('settings.footer.privacyPolicy')}
            onPress={handleOpenPrivacyPolicy}
          >
            <Text variant="caption" tone="accent" style={styles.footerText}>
              {t('settings.footer.privacyPolicy')}
            </Text>
          </Pressable>
        </Box>
      }
    >
      {/* Each setting is its own Card, mirroring the Accounts
          list — the Box gap gives the vertical space between cards. For now,
          if more settings appear that belong together they can be grouped back
          into a shared card; until then one-card-per-setting keeps them
          visually distinct. */}
      <Box gap={4}>
        {/* The System sub-page groups system-level preferences (Language, Color
            Scheme, Face ID) away from the finance settings below. It sits at the
            very top as a navigating row that pushes the System screen. */}
        <Card testID="settings-card-system" padding={3}>
          <SettingsRow
            testID="settings-row-system"
            icon="gearshape"
            label={t('settings.system')}
            onPress={() => navigation.navigate('System')}
          />
        </Card>

        {/* The base currency is FIAT-ONLY: it drives every net-worth conversion,
            so a crypto base (BTC) is not selectable here. The field reuses the
            shared searchable CurrencyField the account/holding forms use, its
            `options` restricted to `fiatCurrencyOptions`. It is wrapped in a
            SettingsRow so it carries the same leading icon + label framing as
            every other settings row; `hideLabel` suppresses CurrencyField's own
            inline caption so "Base Currency" is not shown twice, while the label
            still titles the picker sheet. */}
        <Card testID="settings-card-base-currency" padding={3}>
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
        </Card>

        <Card testID="settings-card-categories" padding={3}>
          <SettingsRow
            testID="settings-row-categories"
            icon="tag"
            label={t('settings.categories')}
            onPress={() => navigation.navigate('Categories')}
          />
        </Card>

        {/* Import and Export share one card as a single "data transfer" group,
            Import first (the more common entry point — bringing existing data
            in) then Export. */}
        <Card testID="settings-card-data-transfer" padding={3}>
          <Box gap={3}>
            <SettingsRow
              testID="settings-row-import-data"
              icon="square.and.arrow.down"
              label={t('settings.dataImport.title')}
              onPress={() => navigation.navigate('ImportData')}
            />

            <SettingsRow
              testID="settings-row-export-data"
              icon="square.and.arrow.up"
              label={t('settings.dataExport.title')}
              onPress={() => navigation.navigate('ExportData')}
            />
          </Box>
        </Card>
      </Box>
    </Screen>
  );
};

export default SettingsScreen;

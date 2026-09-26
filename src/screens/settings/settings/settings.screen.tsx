import { match } from 'ts-pattern';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { PRIVACY_POLICY_URL_EN, PRIVACY_POLICY_URL_UK } from '@env';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { Linking, Pressable, type ScrollViewInstance } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import SettingsRow from '../settings-row';
import pkg from '../../../../package.json';
import Box from '../../../design-system/components/box';
import { useDataReady } from '../../../db/use-data-ready';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Card from '../../../design-system/components/card';
import Screen from '../../../design-system/components/screen';
import Divider from '../../../design-system/components/divider';
import type { SettingsStackParamList } from '../../../navigation/types';
import LoadingState from '../../../design-system/components/loading-state';
import CurrencyField from '../../../design-system/components/currency-field';
import { type Currency, fiatCurrencyOptions } from '../../../currency/currency';
import { useScrollToTopOnTabPress } from '../../../navigation/use-scroll-to-top-on-tab-press';
import { chevronSize, chevronTrailingWhitespace } from '../settings-row/settings-row.chevron';

type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

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
  // DEVICE BUG fix (root cause, same as the account/holding forms — see
  // `holding-form.screen.tsx`'s own comment): while the base-currency sheet's
  // search field can be focused, this screen's background ScrollView must
  // NOT react to the keyboard's frame change — it does not contain that
  // responder, but `automaticallyAdjustKeyboardInsets` reacts to any focus
  // regardless (`screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);

  const { t, i18n } = useTranslation();
  const { theme } = useUnistyles();

  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings'], true, {
    cached: true,
  });
  const settings = data.at(0);
  // The base-currency field must never render as "none selected" while
  // settings is still on its own first load (kiko-architecture's
  // useLiveQuery consumer rule).
  const isReady = useDataReady(isLoading);

  // The Import/Export card's per-row padding and leading-inset divider, both
  // PLAIN objects built from the live theme rather than a
  // `StyleSheet.create()` entry — `StyleSheet.create` styles are meant to be
  // read directly on a component's OWN native element, not forwarded as a
  // `style` prop into a DIFFERENT shared component (`SettingsRow`/`Divider`),
  // where the unistyles runtime does not resolve them. `SettingsRow` gets its
  // own explicit vertical+horizontal padding here (matching the
  // `theme.spacing(3)` every OTHER single-row settings card gets for free
  // from its own `Card` padding, since this card's own padding drops to 0
  // below) so each row reads as a normal native grouped-list row rather than
  // a shorter one squeezed by an outer `Box` gap. The divider's LEFT inset
  // lands on the row LABEL's first letter, so it must clear THREE spans,
  // mirroring how the row itself lays the label out: the row's OWN left
  // `paddingHorizontal` (`theme.spacing(3)`), the leading icon's width
  // (`iconSizes.body`, the default `SettingsRow` icon size), and the
  // icon-to-label gap (another `theme.spacing(3)`). Omitting the row's own
  // padding lands the divider on the icon's RIGHT EDGE instead of the label.
  //
  // The RIGHT inset terminates the divider at the visible right edge of the
  // trailing ">" glyph, not the row's raw padding: it is the row's own
  // `paddingHorizontal` above PLUS the trailing whitespace inside the
  // chevron's own render frame — an SF Symbol glyph is centered in its
  // square frame with visible space on both sides, so the frame's right
  // edge sits past the glyph's own visible tip. Both the chevron's size and
  // that whitespace are derived from the SAME
  // `settings-row.chevron.ts` helpers `SettingsRow` itself uses for the
  // glyph, so this stays in sync if that sizing ever changes.
  const dataTransferRowStyle = {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
  };
  const dataTransferChevronSize = chevronSize(theme);
  const dataTransferDividerStyle = {
    marginLeft: theme.spacing(3) + theme.iconSizes.body + theme.spacing(3),
    marginRight: theme.spacing(3) + chevronTrailingWhitespace(dataTransferChevronSize, theme),
  };

  const handleSelectCurrency = (currency: Currency): void => {
    settingsRepo.setBaseCurrency(currency);
  };

  const handleOpenPrivacyPolicy = (): void => {
    Linking.openURL(resolvePrivacyPolicyUrl(i18n.language));
  };

  if (!isReady) {
    // The SAME Screen mode/props as the ready branch below — the first
    // scroll view iOS walks to drive the large-title collapse exists from
    // the very first render.
    return (
      <Screen scroll scrollableRef={scrollRef}>
        <LoadingState testID="settings-loading" />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollableRef={scrollRef}
      automaticallyAdjustKeyboardInsets={!isCurrencySheetOpen}
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

        {/* Import and Export share one card as a single "data transfer" group,
            positioned directly BELOW System — it previously sat LAST, after
            Categories. Import first (the more common entry point — bringing
            existing data in) then Export.
            Each row now carries its own explicit vertical padding
            (`dataTransferRowStyle`, matching the Card's own padding=3 the
            OTHER single-row cards get for free) with the Card's own padding
            dropped to 0 — an outer `Box gap` no longer supplies the
            spacing, so each row reads as a normal native grouped-list row
            rather than a shorter, gap-squeezed one. The divider is
            LEADING-INSET (`dataTransferDividerStyle`'s `marginLeft`, aligned
            with the row LABEL — past the leading icon, not edge-to-edge),
            the standard iOS grouped-list divider treatment for an icon-led
            row. */}
        <Card testID="settings-card-data-transfer" padding={0}>
          <SettingsRow
            testID="settings-row-import-data"
            icon="square.and.arrow.down"
            label={t('settings.dataImport.rowLabel')}
            onPress={() => navigation.navigate('ImportData')}
            style={dataTransferRowStyle}
          />

          <Divider testID="settings-divider-data-transfer" style={dataTransferDividerStyle} />

          <SettingsRow
            testID="settings-row-export-data"
            icon="square.and.arrow.up"
            label={t('settings.dataExport.rowLabel')}
            onPress={() => navigation.navigate('ExportData')}
            style={dataTransferRowStyle}
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
              onOpenChange={setIsCurrencySheetOpen}
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
      </Box>
    </Screen>
  );
};

export default SettingsScreen;

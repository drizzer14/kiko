import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  bondCouponFrequencies,
  type BondCouponFrequency,
} from '../../../../holdings/holding-metadata';
import { formatDate } from '../../../../dates/format';
import { validateIsin } from '../../../../bonds/isin';
import Box from '../../../../design-system/components/box';
import Text from '../../../../design-system/components/text';
import { activeLocale } from '../../../../i18n/active-locale';
import Button from '../../../../design-system/components/button';
import TextField from '../../../../design-system/components/text-field';
import FieldLabel from '../../../../design-system/components/field-label';
import SelectField from '../../../../design-system/components/select-field';
import SummaryTable from '../../../../design-system/components/summary-table';
import SegmentedControl from '../../../../design-system/components/segmented-control';

import type { BondEntryMode, BondIsinSectionProps } from './bond-isin-section.props';

const modeLabels = (t: TFunction): Record<BondEntryMode, string> => ({
  isin: t('forms.holding.isinModeIsin'),
  manual: t('forms.holding.isinModeManual'),
});

// Exported (not local to this file) since `ManualBondFields` needs the exact
// same map for its OWN coupon-frequency `ChipRow` — T25 review round 2,
// Minor 6: this used to be written out twice; keeping one avoids the two
// ever drifting apart.
export const couponFrequencyLabels = (t: TFunction): Record<BondCouponFrequency, string> => ({
  monthly: t('forms.holding.monthly'),
  quarterly: t('forms.holding.quarterly'),
  semiannually: t('forms.holding.semiannually'),
  annually: t('forms.holding.annually'),
});

/**
 * The Bond form's ISIN/Manual mode section (spec 6.3/6.4): the shared
 * design-system `SegmentedControl` (F3/T24 ruling — one control type per
 * kind of mode choice, not a `ChipRow`), the ISIN text field itself (always
 * shown — required in ISIN mode, optional but still validated in Manual
 * mode, see `useBondIsinMode`'s own `isinReasonKey`), a read-only summary
 * once the register finds a match (plus, when that match left
 * `couponFrequency` unmapped, a picker with no default — spec 6.2 forbids
 * guessing one), a not-in-register/not-loaded hint with a Switch-to-manual
 * button when a validly-shaped ISIN has no match, and the Diia hint (spec
 * 7.1), which renders in every mode since Diia bonds land under a partner
 * institution regardless of how THIS holding gets added.
 *
 * Purely presentational, like `MetalSection`/`PropertySection`: the NBU
 * register lookup and every auto-fill/validation decision live in
 * `useBondIsinMode`; this component only renders what it is handed.
 */
const BondIsinSection: FC<BondIsinSectionProps> = ({
  mode,
  onSelectMode,
  isin,
  onChangeIsin,
  isinError,
  isinFieldRef,
  isinInputRef,
  foundTerms,
  registerLoaded,
  onSwitchToManual,
  needsCouponFrequencyPick,
  pickedCouponFrequency,
  onPickCouponFrequency,
  couponFrequencyError,
}) => {
  const { t } = useTranslation();

  // A "not found" hint only makes sense once the typed candidate is a
  // complete, validly-shaped (check-digit-passing) ISIN — otherwise it would
  // flash on every keystroke while the user is still mid-typing.
  const isValidlyShaped = validateIsin(isin).ok;
  const showNotFoundHint = mode === 'isin' && foundTerms === null && isValidlyShaped;

  return (
    <Box gap={4}>
      <Box gap={1} testID="bond-isin-mode">
        <FieldLabel label={t('forms.holding.isinMode')} />

        <SegmentedControl<BondEntryMode>
          options={['isin', 'manual']}
          selected={mode}
          onSelect={onSelectMode}
          labels={modeLabels(t)}
          accessibilityLabel={t('forms.holding.isinMode')}
          testID="bond-isin-mode-control"
        />
      </Box>

      <View ref={isinFieldRef}>
        <TextField
          label={t('forms.holding.isin')}
          value={isin}
          onChangeText={onChangeIsin}
          placeholder={t('forms.holding.isinPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          required={mode === 'isin'}
          error={isinError}
          inputRef={isinInputRef}
        />
      </View>

      {mode === 'isin' && foundTerms !== null && (
        // F4 audit item 12: three "X: value" captions -> the shared
        // "label left, value right" SummaryTable, the same row layout the
        // holding-detail value breakdown and the statement-import preview
        // already use, instead of a one-off stack of colon-joined captions.
        <SummaryTable
          testID="bond-isin-summary"
          rows={[
            {
              key: 'coupon',
              label: t('forms.holding.couponPct'),
              value: (
                <Text variant="caption" tone="textSecondary">
                  {`${foundTerms.couponPct.toLocaleString(activeLocale())}%`}
                </Text>
              ),
            },
            {
              key: 'maturity',
              label: t('forms.holding.maturityDate'),
              value: (
                <Text variant="caption" tone="textSecondary">
                  {formatDate(foundTerms.maturityDate)}
                </Text>
              ),
            },
            {
              key: 'currency',
              label: t('forms.fields.currency'),
              value: (
                <Text variant="caption" tone="textSecondary">
                  {foundTerms.currency}
                </Text>
              ),
            },
          ]}
        />
      )}

      {needsCouponFrequencyPick && (
        // F4 audit item 10: a `ChipRow` with no chip selected read as a
        // picker nobody had touched yet, not a deliberately blank "no
        // default" (spec 6.2 forbids guessing one). `SelectField` supports
        // `selected: null` directly (no more widening the option type to
        // fake an empty string match) and shows a "Select..." placeholder
        // in the trigger instead.
        <SelectField
          label={t('forms.holding.couponFrequency')}
          sheetTitle={t('forms.holding.couponFrequencySheetTitle')}
          options={bondCouponFrequencies}
          selected={pickedCouponFrequency}
          onSelect={onPickCouponFrequency}
          labels={couponFrequencyLabels(t)}
          placeholder={t('forms.holding.couponFrequencyPlaceholder')}
          required
          error={couponFrequencyError}
          testID="bond-coupon-frequency-field"
        />
      )}

      {showNotFoundHint && (
        <Box gap={2} testID="bond-isin-not-found">
          {/* F4 audit item 11: this used to render through the red
              `FieldError` — a blocking-validation tone for a hint the user
              can act on (Switch to Manual) rather than a form error to fix
              in place. The Diia hint two rows below is the exact same
              caption/textSecondary tone; this now matches it. */}
          <Text variant="caption" tone="textSecondary">
            {t(
              registerLoaded
                ? 'forms.holding.isinNotInRegister'
                : 'forms.holding.isinRegisterNotLoaded',
            )}
          </Text>

          <Button
            variant="secondaryTonal"
            size="small"
            fullWidth={false}
            onPress={onSwitchToManual}
          >
            {t('forms.holding.switchToManual')}
          </Button>
        </Box>
      )}

      <Text variant="caption" tone="textSecondary">
        {t('forms.holding.diiaHint')}
      </Text>
    </Box>
  );
};

export default BondIsinSection;

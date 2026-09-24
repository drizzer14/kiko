import type { FC } from 'react';
import type { TFunction } from 'i18next';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import Box from '../../../../design-system/components/box';
import Text from '../../../../design-system/components/text';
import Button from '../../../../design-system/components/button';
import { formatDate } from '../../../../dates/format';
import { normalizeIsin, validateIsin } from '../../../../bonds/isin';
import TextField from '../../../../design-system/components/text-field';
import FieldLabel from '../../../../design-system/components/field-label';
import FieldError from '../../../../design-system/components/field-error';
import SegmentedControl from '../../../../design-system/components/segmented-control';

import type { BondEntryMode, BondIsinSectionProps } from './bond-isin-section.props';

const modeLabels = (t: TFunction): Record<BondEntryMode, string> => ({
  isin: t('forms.holding.isinModeIsin'),
  manual: t('forms.holding.isinModeManual'),
});

/**
 * The Bond form's ISIN/Manual mode section (T25, spec 6.3/6.4): the shared
 * design-system `SegmentedControl` (F3/T24 ruling — one control type per
 * kind of mode choice, not a `ChipRow`), the ISIN text field itself (always
 * shown — required in ISIN mode, optional but still validated in Manual
 * mode, see `holding-form.screen.tsx`'s own `isinReasonKey`), a read-only
 * summary once the register finds a match, a "not in the register" hint
 * with a Switch-to-manual button when a validly-shaped ISIN has no match
 * (spec 6.4 #3 — covers BOTH "not found" and "offline with no cache", which
 * read identically here: `foundTerms` is simply `null`), and the Diia hint
 * (spec 7.1), which renders in every mode since Diia bonds land under a
 * partner institution regardless of how THIS holding gets added.
 *
 * Purely presentational, like `MetalSection`/`PropertySection`: the NBU
 * register lookup (`useLiveQuery` against `bondRegisterRepo`) and every
 * auto-fill/validation decision live in the parent screen; this component
 * only renders what it is handed.
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
  onSwitchToManual,
}) => {
  const { t } = useTranslation();

  // A "not found" hint only makes sense once the typed candidate is a
  // complete, validly-shaped (check-digit-passing) ISIN — otherwise it would
  // flash on every keystroke while the user is still mid-typing.
  const isValidlyShaped = validateIsin(isin).ok;
  const showFoundSummary = mode === 'isin' && foundTerms !== null;
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
          onChangeText={(text) => onChangeIsin(normalizeIsin(text))}
          placeholder={t('forms.holding.isinPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          required={mode === 'isin'}
          error={isinError}
          inputRef={isinInputRef}
        />
      </View>

      {showFoundSummary && foundTerms !== null && (
        <Box gap={2} testID="bond-isin-summary">
          <Text variant="caption" tone="textSecondary">
            {t('forms.holding.couponPct')}: {foundTerms.couponPct}%
          </Text>
          <Text variant="caption" tone="textSecondary">
            {t('forms.holding.maturityDate')}: {formatDate(foundTerms.maturityDate)}
          </Text>
          <Text variant="caption" tone="textSecondary">
            {t('forms.fields.currency')}: {foundTerms.currency}
          </Text>
        </Box>
      )}

      {showNotFoundHint && (
        <Box gap={2} testID="bond-isin-not-found">
          <FieldError message={t('forms.holding.isinNotInRegister')} />

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

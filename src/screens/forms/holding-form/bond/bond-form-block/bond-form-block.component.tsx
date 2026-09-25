import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import DateField from '../../../date-field';
import BondIsinSection from '../bond-isin-section';
import ManualBondFields from '../manual-bond-fields';
import Box from '../../../../../design-system/components/box';
import { fieldErrorMessage } from '../../field-error-message';
import Text from '../../../../../design-system/components/text';
import { currencySymbol } from '../../../../../currency/currency';
import { groupAmount } from '../../../amount-format/amount-format';
import Divider from '../../../../../design-system/components/divider';
import TextField from '../../../../../design-system/components/text-field';
import type { IsinReasonKey } from '../use-bond-isin-mode/use-bond-isin-mode';
import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';
import type { BondCouponFrequency } from '../../../../../holdings/holding-metadata';

import type { BondFormBlockProps } from './bond-form-block.props';

// The ISIN field's OWN inline error text — every `isinReasonKey` EXCEPT
// `isinNotInRegister`, which `BondIsinSection` already surfaces as its own
// always-visible hint (not gated on Save), so showing it here too would
// duplicate that message.
const isinFieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: IsinReasonKey | null,
): string | undefined =>
  reasonKey === null ||
  reasonKey === 'forms.holding.isinNotInRegister' ||
  reasonKey === 'forms.holding.isinRegisterNotLoaded'
    ? undefined
    : fieldErrorMessage(t, attemptedSave, reasonKey);

// The ISIN-mode-only coupon-frequency picker's OWN blocking error: only
// once a Save attempt was made, only for the one match that left
// `couponFrequency` unmapped, and only until the user picks one.
const couponFrequencyErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  needsCouponFrequencyPick: boolean,
  pickedCouponFrequency: BondCouponFrequency | null,
): string | undefined =>
  attemptedSave && needsCouponFrequencyPick && pickedCouponFrequency === null
    ? t('forms.holding.couponFrequencyRequiredError')
    : undefined;

// ISIN mode never mounts the maturity DateField (its terms are
// register-sourced) — a matured-still-registered bond's reason (or
// register terms with no maturity date at all) is shown on the purchase
// date instead, the one date the user actually controls there. The
// purchase field's OWN missing-date reason (`ownError`) always takes
// priority over a redirected maturity reason, in both modes.
const purchaseDateErrorMessage = (
  bondMode: BondEntryMode,
  ownError: string | undefined,
  maturityDateErrorMessage: string | undefined,
): string | undefined => ownError ?? (bondMode === 'isin' ? maturityDateErrorMessage : undefined);

// The `type === 'bond'` details block as its own leaf component, keeping
// its own cognitive-complexity budget separate from the screen's.
const BondFormBlock: FC<BondFormBlockProps> = ({ fields, attemptedSave }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  const maturityDateErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    fieldErrors.maturityDateError,
  );
  const purchaseDateOwnErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    fieldErrors.purchaseDateError,
  );

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <BondIsinSection
        mode={fields.bondMode}
        onSelectMode={fields.setBondMode}
        isin={fields.isin}
        onChangeIsin={fields.setIsin}
        isinError={isinFieldErrorMessage(t, attemptedSave, fields.isinReasonKey)}
        isinFieldRef={refs.isinFieldRef}
        isinInputRef={refs.isinInputRef}
        foundTerms={fields.registerTerms}
        registerLoaded={fields.registerLoaded}
        onSwitchToManual={() => fields.setBondMode('manual')}
        needsCouponFrequencyPick={fields.needsCouponFrequencyPick}
        pickedCouponFrequency={fields.pickedCouponFrequency}
        onPickCouponFrequency={fields.setPickedCouponFrequency}
        couponFrequencyError={couponFrequencyErrorMessage(
          t,
          attemptedSave,
          fields.needsCouponFrequencyPick,
          fields.pickedCouponFrequency,
        )}
      />

      <View ref={refs.quantityFieldRef}>
        <TextField
          label={t('forms.holding.quantity')}
          value={fields.quantity}
          onChangeText={(text) => fields.setQuantity(groupAmount(text))}
          keyboardType="number-pad"
          placeholder={t('forms.holding.quantityPlaceholder')}
          required
          error={fieldErrorMessage(t, attemptedSave, fieldErrors.quantityError)}
          inputRef={refs.quantityInputRef}
        />
      </View>

      <TextField
        label={t('forms.holding.purchasePrice')}
        value={fields.purchasePrice}
        onChangeText={(text) => fields.setPurchasePrice(groupAmount(text))}
        keyboardType="decimal-pad"
        placeholder={t('forms.holding.purchasePricePlaceholder')}
        suffix={currencySymbol[fields.currency]}
      />

      {/* See `purchaseDateErrorMessage`'s own doc comment. */}
      <View ref={refs.purchaseDateFieldRef}>
        <DateField
          label={t('forms.holding.purchaseDate')}
          value={fields.purchaseDate}
          onChange={fields.setPurchaseDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
          required
          error={purchaseDateErrorMessage(
            fields.bondMode,
            purchaseDateOwnErrorMessage,
            maturityDateErrorMessage,
          )}
        />
      </View>

      <ManualBondFields
        bondMode={fields.bondMode}
        faceValue={fields.faceValue}
        onChangeFaceValue={(text) => fields.setFaceValue(groupAmount(text))}
        faceValueError={fieldErrorMessage(t, attemptedSave, fieldErrors.faceValueError)}
        faceValueFieldRef={refs.faceValueFieldRef}
        faceValueInputRef={refs.faceValueInputRef}
        couponPct={fields.couponPct}
        onChangeCouponPct={fields.setCouponPct}
        couponPctError={fieldErrorMessage(t, attemptedSave, fieldErrors.couponPctError)}
        couponPctFieldRef={refs.couponPctFieldRef}
        couponPctInputRef={refs.couponPctInputRef}
        maturityDate={fields.maturityDate}
        onChangeMaturityDate={fields.setMaturityDate}
        maturityDateError={maturityDateErrorMessage}
        maturityDateFieldRef={refs.maturityDateFieldRef}
        bondKind={fields.bondKind}
        onSelectBondKind={fields.setBondKind}
        couponFrequency={fields.couponFrequency}
        onSelectCouponFrequency={fields.setCouponFrequency}
        currencySuffix={currencySymbol[fields.currency]}
      />
    </Box>
  );
};

export default BondFormBlock;

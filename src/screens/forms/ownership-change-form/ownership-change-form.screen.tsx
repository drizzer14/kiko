import { useLiveQuery } from '@kiko/db';
import { useTranslation } from 'react-i18next';
import {
  enteredShare,
  ownershipEntryOf,
  type OwnershipEntry,
} from '@kiko/screens/forms/property-ownership';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { TextInputInstance } from 'react-native';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { type FC, useEffect, useRef, useState } from 'react';
import { asPropertyMeta } from '@kiko/holdings/holding-metadata';
import OwnershipField from '@kiko/screens/forms/ownership-field';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { dayKeyOf, localMidnightOfDayKey } from '@kiko/prices/price-book';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import { WHOLE_SHARE, type OwnershipShare } from '@kiko/holdings/ownership';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type OwnershipChangeFormScreenProps = NativeStackScreenProps<
  AccountsStackParamList,
  'OwnershipChangeForm'
>;

// Edits one stored share change of a property, reached from the holding
// detail's Share changes list. Save passes the holding id and the change's
// original day key; the repo re-reads the list inside its write.
const OwnershipChangeFormScreen: FC<OwnershipChangeFormScreenProps> = ({ route, navigation }) => {
  const { holdingId, day } = route.params;
  const { t } = useTranslation();
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const meta = asPropertyMeta(holdings.find((candidate) => candidate.id === holdingId)?.metadata);
  const change = meta?.ownership?.find((candidate) => candidate.day === day);
  const input = meta?.ownershipInput ?? 'percent';

  const [entry, setEntry] = useState<OwnershipEntry>(() =>
    ownershipEntryOf('percent', WHOLE_SHARE),
  );
  const [current, setCurrent] = useState<OwnershipShare>(WHOLE_SHARE);
  const [effectiveDate, setEffectiveDate] = useState(() => localMidnightOfDayKey(day));
  const [attemptedSave, setAttemptedSave] = useState(false);

  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();
  const fieldRef = useRef<FieldInstance>(null);
  const inputRef = useRef<TextInputInstance>(null);

  // Seeded once: a later live-query emission must not clobber what the user typed.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || change === undefined) {
      return;
    }
    hydrated.current = true;
    const share = { numerator: change.numerator, denominator: change.denominator };
    setCurrent(share);
    setEntry(ownershipEntryOf(input, share));
  }, [change, input]);

  const share = enteredShare(entry, current);

  const updateEntry = (patch: Partial<OwnershipEntry>): void =>
    setEntry((previous) => ({ ...previous, ...patch }));

  const save = async (): Promise<void> => {
    if (!hydrated.current) {
      return;
    }

    if (share === null) {
      setAttemptedSave(true);
      scrollTo(fieldRef, () => inputRef.current?.focus());

      return;
    }

    try {
      await holdingsRepo.editOwnershipChange(
        holdingId,
        day,
        {
          day: dayKeyOf(effectiveDate),
          numerator: share.numerator,
          denominator: share.denominator,
        },
        entry.mode,
      );
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }
    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      onContentSizeChange={onContentSizeChange}
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      }
    >
      <OwnershipField
        mode={entry.mode}
        onSelectMode={(mode) => updateEntry({ mode })}
        percent={entry.percent}
        onChangePercent={(percent) => updateEntry({ percent })}
        numerator={entry.numerator}
        onChangeNumerator={(numerator) => updateEntry({ numerator })}
        denominator={entry.denominator}
        onChangeDenominator={(denominator) => updateEntry({ denominator })}
        showsEffectiveDate
        effectiveDate={effectiveDate}
        onChangeEffectiveDate={setEffectiveDate}
        error={attemptedSave && share === null ? t('forms.holding.ownershipError') : undefined}
        fieldRef={fieldRef}
        inputRef={inputRef}
      />
    </Screen>
  );
};

export default OwnershipChangeFormScreen;

import {
  type ReminderDraft,
  defaultDraft,
  withFrequency,
  draftToSchedule,
  draftFromSchedule,
  everyDaysPluralCount,
  validateReminderDraft,
} from '@kiko/reminders/rules';
import {
  localDayOf,
  type ReminderKind,
  isReminderSchedule,
  type ReminderSchedule,
} from '@kiko/reminders/schedule';
import { match } from 'ts-pattern';
import { useLiveQuery } from '@kiko/db';
import type { TFunction } from 'i18next';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { useTranslation } from 'react-i18next';
import { remindersRepo } from '@kiko/reminders/repo';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import TimeField from '@kiko/screens/forms/time-field';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import WeekdayField from '@kiko/screens/forms/weekday-field';
import type { ReminderFormParams } from '@kiko/navigation/types';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import FieldLabel from '@kiko/design-system/components/field-label';
import { useNotificationPreAlert } from '@kiko/reminders/permission';
import SelectField from '@kiko/design-system/components/select-field';
import { replanReminders } from '@kiko/reminders/use-reminder-scheduler';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import NotificationPreAlertSheet from '@kiko/design-system/components/notification-pre-alert-sheet';

// Registered in both the Accounts and Settings stacks, so the props name only
// what the form reads, which either stack's props satisfy.
type ReminderFormScreenProps = {
  route: { params: ReminderFormParams };
  navigation: { goBack: () => void; setOptions: (options: { title: string }) => void };
};

type ReminderFrequency = ReminderSchedule['frequency'];

const FREQUENCIES: readonly ReminderFrequency[] = ['daily', 'weekly', 'monthly', 'interval'];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_unused, index) => String(index + 1));

const DAY_OF_MONTH_LABELS = Object.fromEntries(DAYS_OF_MONTH.map((day) => [day, day]));

// The shortest month has 28 days, so a later day falls back to the last one.
const FIRST_DAY_NOT_IN_EVERY_MONTH = 29;

const MINUTES_PER_HOUR = 60;

// Any day with no DST change: on a transition day a wall-clock time such as
// 03:30 may not exist, and the field would show a shifted time.
const timeFieldValue = (minuteOfDay: number): number =>
  new Date(2000, 0, 1, 0, minuteOfDay).getTime();

const minuteOfDayOf = (timestamp: number): number => {
  const date = new Date(timestamp);

  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
};

const writeReminder = (params: ReminderFormParams, schedule: ReminderSchedule): Promise<unknown> =>
  'reminderId' in params
    ? remindersRepo.update(params.reminderId, schedule)
    : remindersRepo.create({ accountId: params.accountId, kind: params.kind, schedule });

const fieldErrors = (
  draft: ReminderDraft,
  attemptedSave: boolean,
  t: TFunction,
): { weekdays?: string; interval?: string } => {
  if (!attemptedSave) {
    return {};
  }

  const errors = validateReminderDraft(draft);

  return {
    weekdays: errors.weekdaysError ? t('reminders.form.weekdaysError') : undefined,
    interval: errors.intervalError ? t('reminders.form.intervalDaysError') : undefined,
  };
};

// Creates the one reminder of a kind an account can have, or edits a saved
// one. The first save while iOS has not asked yet shows the pre-alert, then
// the iOS prompt; the reminder is kept whatever the answer.
const ReminderFormScreen: FC<ReminderFormScreenProps> = ({ route, navigation }) => {
  const { params } = route;
  const reminderId = 'reminderId' in params ? params.reminderId : undefined;
  const isEdit = reminderId !== undefined;
  const { t } = useTranslation();
  const { data: saved } = useLiveQuery(
    remindersRepo.byIdQuery(reminderId ?? ''),
    ['reminders'],
    isEdit,
  );
  const savedReminder = saved.at(0);
  const kind: ReminderKind | undefined = 'kind' in params ? params.kind : savedReminder?.kind;

  const [draft, setDraft] = useState<ReminderDraft>(() =>
    defaultDraft('kind' in params ? params.kind : 'add_transactions'),
  );
  const [attemptedSave, setAttemptedSave] = useState(false);

  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const weekdaysFieldRef = useRef<FieldInstance>(null);
  const intervalFieldRef = useRef<FieldInstance>(null);
  const intervalInputRef = useRef<TextInputInstance>(null);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);

  const preAlert = useNotificationPreAlert(() => navigation.goBack());

  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('reminders.form.editTitle') });
    }
  }, [navigation, isEdit, t]);

  // Seeded once: a later live-query emission must not clobber the user's edits.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || savedReminder === undefined) {
      return;
    }

    hydrated.current = true;

    const schedule: unknown = savedReminder.schedule;

    // A restored row may carry another build's schedule shape; the user then
    // starts again from the kind's defaults.
    setDraft(
      isReminderSchedule(schedule)
        ? draftFromSchedule(savedReminder.kind, schedule)
        : defaultDraft(savedReminder.kind),
    );
  }, [savedReminder]);

  const errors = fieldErrors(draft, attemptedSave, t);

  const updateDraft = (patch: Partial<ReminderDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));

  const scrollTo = (fieldRef: typeof weekdaysFieldRef, onSettled?: () => void): void =>
    scrollToField(
      scrollableRef,
      fieldRef,
      { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
      onSettled,
    );

  const save = async (): Promise<void> => {
    if (isEdit && !hydrated.current) {
      return;
    }

    const validation = validateReminderDraft(draft);

    if (validation.weekdaysError || validation.intervalError) {
      setAttemptedSave(true);
      match(validation.weekdaysError === true)
        .with(true, () => scrollTo(weekdaysFieldRef))
        .with(false, () => scrollTo(intervalFieldRef, () => intervalInputRef.current?.focus()))
        .exhaustive();

      return;
    }

    try {
      await writeReminder(params, draftToSchedule(draft, localDayOf(Date.now())));
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    replanReminders();

    if (preAlert.status === 'notDetermined') {
      preAlert.open();

      return;
    }

    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  const frequencyField = match(draft.frequency)
    .with('daily', () => null)
    .with('weekly', () => (
      <WeekdayField
        label={t('reminders.form.weekdays')}
        selected={draft.weekdays}
        onChange={(weekdays) => updateDraft({ weekdays })}
        error={errors.weekdays}
        fieldRef={weekdaysFieldRef}
      />
    ))
    .with('monthly', () => (
      <Box gap={1}>
        <SelectField
          label={t('reminders.form.dayOfMonth')}
          sheetTitle={t('reminders.form.dayOfMonthSheetTitle')}
          options={DAYS_OF_MONTH}
          selected={String(draft.dayOfMonth)}
          onSelect={(day) => updateDraft({ dayOfMonth: Number(day) })}
          labels={DAY_OF_MONTH_LABELS}
          placeholder={t('reminders.form.dayOfMonthPlaceholder')}
          testID="reminder-day-of-month"
        />

        {draft.dayOfMonth >= FIRST_DAY_NOT_IN_EVERY_MONTH && (
          <Text variant="caption" tone="textSecondary">
            {t('reminders.form.dayOfMonthHint')}
          </Text>
        )}
      </Box>
    ))
    .with('interval', () => (
      <View ref={intervalFieldRef}>
        <TextField
          label={t('reminders.form.intervalDays')}
          value={draft.everyDaysText}
          onChangeText={(everyDaysText) => updateDraft({ everyDaysText })}
          keyboardType="number-pad"
          suffix={t('forms.units.days', { count: everyDaysPluralCount(draft.everyDaysText) })}
          required
          error={errors.interval}
          inputRef={intervalInputRef}
        />
      </View>
    ))
    .exhaustive();

  return (
    <>
      <Screen
        scroll
        scrollableRef={scrollableRef}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
        }}
        footer={
          <Button onPress={onSave} disabled={isSubmitting}>
            {t('common.save')}
          </Button>
        }
      >
        <Box gap={4}>
          {kind !== undefined && (
            <Text variant="body" tone="textSecondary">
              {match(kind)
                .with('statement_import', () => t('reminders.kindHint.statementImport'))
                .with('add_transactions', () => t('reminders.kindHint.addTransactions'))
                .exhaustive()}
            </Text>
          )}

          <Box gap={1}>
            <FieldLabel label={t('reminders.form.frequency')} />
            {/* The frequency decides which fields follow, so it is a
                segmented control, not a chip row. */}
            <SegmentedControl<ReminderFrequency>
              options={FREQUENCIES}
              selected={draft.frequency}
              onSelect={(frequency) =>
                setDraft((current) => withFrequency(current, frequency, localDayOf(Date.now())))
              }
              labels={{
                daily: t('reminders.form.frequencyDaily'),
                weekly: t('reminders.form.frequencyWeekly'),
                monthly: t('reminders.form.frequencyMonthly'),
                interval: t('reminders.form.frequencyInterval'),
              }}
              accessibilityLabel={t('reminders.form.frequency')}
              testID="reminder-frequency"
            />
          </Box>

          {frequencyField}

          <TimeField
            label={t('reminders.form.time')}
            sheetTitle={t('reminders.form.timeSheetTitle')}
            value={timeFieldValue(draft.minuteOfDay)}
            onChange={(timestamp) => updateDraft({ minuteOfDay: minuteOfDayOf(timestamp) })}
            placeholder={t('reminders.form.timePlaceholder')}
          />
        </Box>
      </Screen>

      <NotificationPreAlertSheet {...preAlert.sheet} />
    </>
  );
};

export default ReminderFormScreen;

import { match } from 'ts-pattern';
import { useLiveQuery } from '@kiko/db';
import { formatDate } from '@kiko/dates';
import type { TFunction } from 'i18next';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import Screen, {
  useContentCap,
  useContentMargin,
  useScrollIndicatorProps,
  useAutomaticScrollClearance,
} from '@kiko/design-system/components/screen';
import Box from '@kiko/design-system/components/box';
import { categoriesRepo } from '@kiko/categories/repo';
import Text from '@kiko/design-system/components/text';
import { transactionsRepo } from '@kiko/transactions/repo';
import Button from '@kiko/design-system/components/button';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import { paidSoFarOf } from '@kiko/recurring/recurring-groups';
import { type FC, useCallback, useMemo, useState } from 'react';
import { recurrenceLine } from '@kiko/recurring/recurrence-text';
import type { RecurringSeries } from '@kiko/recurring/detection';
import MoneyText from '@kiko/design-system/components/money-text';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import EmptyState from '@kiko/design-system/components/empty-state';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import { FlatList, type FlatListProps, Pressable } from 'react-native';
import LoadingState from '@kiko/design-system/components/loading-state';
import SummaryTable from '@kiko/design-system/components/summary-table';
import { useRecurringSeries } from '@kiko/recurring/use-recurring-series';
import { useFloatingFooterEnd } from '@kiko/design-system/floating-footer';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import TransactionCard from '@kiko/design-system/components/transaction-card';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';
import { useIsScreenVisible, useOpenInPane } from '@kiko/navigation/pane-stack';

import { styles } from './recurring-series.styles';

type RecurringSeriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'RecurringSeries'>;

type RouteParams = RecurringSeriesScreenProps['route']['params'];

// A charge has the merchant's own text as its description, so its row text never comes from a
// counterpart holding and needs no holding names.
const NO_HOLDING_TEXT: ReadonlyMap<string, string> = new Map();

const spanHolds = (span: RecurringSeries['markedSpan'], amountMinorUnits: number): boolean =>
  span !== undefined && span.lowest <= amountMinorUnits && amountMinorUnits <= span.highest;

// A route that holds a stored amount finds the marked series of its key and currency whose span
// holds it, and nothing else: its `seriesId` and period may be the chain's old ones, so any other
// step would guess. Without one: the marked series holding its `seriesId`; then the detected series
// by its id, when it also has the route's merchant key and currency (an id can pass to another
// merchant's series when a charge is renamed); on a miss (an older import moved the earliest
// charge) the one detected series with the same key, currency and period. With none or several
// there is no series: a guess could show another merchant's charges.
const seriesOfRoute = (
  detected: readonly RecurringSeries[],
  marked: readonly RecurringSeries[],
  { seriesId, merchantKey, currency, period, markedAmountMinorUnits }: RouteParams,
): RecurringSeries | undefined => {
  const isOfRoute = (candidate: RecurringSeries): boolean =>
    candidate.merchantKey === merchantKey && candidate.currency === currency;

  if (markedAmountMinorUnits !== undefined) {
    return marked.find(
      (candidate) =>
        isOfRoute(candidate) && spanHolds(candidate.markedSpan, markedAmountMinorUnits),
    );
  }

  const sameMerchant = detected.filter(isOfRoute);
  const sameKind = sameMerchant.filter((candidate) => candidate.period === period);

  return (
    marked.find((candidate) => isOfRoute(candidate) && candidate.chargeIds.includes(seriesId)) ??
    sameMerchant.find(({ id }) => id === seriesId) ??
    (sameKind.length === 1 ? sameKind[0] : undefined)
  );
};

// A stopped series says why it is shown as one: the quiet holding's own line, or the plain value.
const statusTextOf = (series: RecurringSeries, t: TFunction): string =>
  series.quiet === null
    ? t('recurringCharges.summary.stopped')
    : t('recurringCharges.holdingQuietSince', {
        holding: series.quiet.holdingName,
        date: formatDate(series.quiet.since),
      });

type ChargeRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

type ChargeListProps = Omit<FlatListProps<ChargeRow>, 'contentContainerStyle'> & {
  contentContainerStyle: (
    floatingFooterEnd: number | undefined,
  ) => FlatListProps<ChargeRow>['contentContainerStyle'];
};

// The charges' FlatList, a descendant of `Screen` only so it can read the floating footer's end
// padding, which the screen component itself, being `Screen`'s parent, cannot.
const ChargeList: FC<ChargeListProps> = ({ contentContainerStyle, ...listProps }) => {
  const floatingFooterEnd = useFloatingFooterEnd();

  return (
    <FlatList {...listProps} contentContainerStyle={contentContainerStyle(floatingFooterEnd)} />
  );
};

// One series, every past charge of it. The list stays mounted while the series read is queued and
// shows the loading state in place of its rows, never the neutral text.
const RecurringSeriesScreen: FC<RecurringSeriesScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const scheme = useActiveColorScheme();
  const { series: detectedSeries, markedSeries, isLoading } = useRecurringSeries();
  // The marks a Remove mark took away leave the hook's marked series with the settings read, ahead
  // of `goBack`; the series it removed stays on screen until then. Only this screen's own write
  // sets it: the same removal made elsewhere shows the neutral text.
  const [removedSeries, setRemovedSeries] = useState<RecurringSeries>();
  const series = removedSeries ?? seriesOfRoute(detectedSeries, markedSeries, route.params);
  const isVisible = useIsScreenVisible();
  // Paused under the form a charge opens: on Back the last rows show until the one re-read lands.
  const liveOptions = { paused: !isVisible } as const;
  const { data: rows, isLoading: rowsLoading } = useLiveQuery(
    transactionsRepo.listWithContextByIdsQuery(series?.chargeIds ?? []),
    ['transactions', 'holdings', 'accounts'],
    true,
    liveOptions,
  );
  const { data: categories } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    liveOptions,
  );
  const { data: settingsRows } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  const openInPane = useOpenInPane();
  const headingScrollProps = useLargeTitleScroll();
  const bottomClearance = useAutomaticScrollClearance();
  const contentMargin = useContentMargin();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();
  const categoryByKey = buildCategoryDisplayMap(categories);
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  // In the order of the series' own ids, so a row deleted or not yet read leaves no gap in the
  // count it is shown under.
  const charges = useMemo(() => {
    const rowById = new Map(rows.map((row) => [row.id, row]));

    return (series?.chargeIds ?? []).flatMap((id) => rowById.get(id) ?? []);
  }, [rows, series]);
  // Leaves only after the write, and only while still the focused screen: the charges stay
  // pressable while it is queued, and a form opened over this screen must not be popped for it.
  // The list it returns to re-reads on focus, so Back can show the merchant until that read lands.
  // The series stays on screen until it leaves: the hook hands it over before any hide filters it.
  const hide = async (): Promise<void> => {
    if (series === undefined) {
      return;
    }

    try {
      await settingsRepo.hideRecurringMerchant(series.merchantKey, series.name);
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    if (navigation.isFocused()) {
      navigation.goBack();
    }
  };
  const { onPress: onHide, isSubmitting: isHiding } = useSubmitOnce(hide);
  // The same way out as the hide, for the marks of the marked series on screen.
  const removeMark = async (): Promise<void> => {
    if (series?.marks === undefined) {
      return;
    }

    setRemovedSeries(series);

    try {
      await settingsRepo.removeRecurringMarks(series.merchantKey, series.marks);
    } catch {
      setRemovedSeries(undefined);
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    if (navigation.isFocused()) {
      navigation.goBack();
    } else {
      setRemovedSeries(undefined);
    }
  };
  const { onPress: onRemoveMark, isSubmitting: isRemovingMark } = useSubmitOnce(removeMark);
  const openCharge = useCallback(
    (transactionId: string): void => {
      openInPane('TransactionForm', { transactionId });
    },
    [openInPane],
  );

  const emptyComponent = match({ isLoading, series, rowsLoading })
    .with({ isLoading: true }, () => <LoadingState testID="recurring-series-loading" />)
    .with({ series: undefined }, () => (
      <EmptyState
        icon={entrySymbol.recurringCharges}
        title={t('recurringCharges.listChangedTitle')}
        message={t('recurringCharges.listChangedMessage')}
        testID="recurring-series-empty"
      />
    ))
    .with({ rowsLoading: true }, () => <LoadingState testID="recurring-series-loading" />)
    .otherwise(() => undefined);

  return (
    // The lone action is secondary, never a primary: it takes the series out of the list, the way
    // the Edit template footer's lone action does.
    <Screen
      bleedTop
      floatingFooter
      footer={foldMap(maybe(series), ({ marks }) =>
        marks === undefined ? (
          <Button
            variant="secondaryTonal"
            loading={isHiding}
            onPress={onHide}
            testID="recurring-series-hide"
          >
            {t('recurringCharges.notRecurring')}
          </Button>
        ) : (
          <Button
            variant="secondaryTonal"
            loading={isRemovingMark}
            onPress={onRemoveMark}
            testID="recurring-series-remove-mark"
          >
            {t('recurringCharges.removeMark')}
          </Button>
        ),
      )}
    >
      <ChargeList
        data={charges}
        keyExtractor={({ id }) => id}
        renderItem={({ item: row }) => {
          const category = resolveCategoryDisplay(row.category, categoryByKey, defaultCategoryKey);

          return (
            <Pressable accessibilityRole="button" onPress={() => openCharge(row.id)}>
              <TransactionCard
                title={transactionRowDescription({
                  transaction: row,
                  holdingName: row.holdingName,
                  holdingNameById: NO_HOLDING_TEXT,
                  holdingCurrencyById: NO_HOLDING_TEXT,
                  t,
                })}
                categoryIcon={category.icon}
                categoryIconColor={resolveCategoryColor(
                  category.color,
                  resolveCategoryKey(row.category, categoryByKey, defaultCategoryKey),
                  scheme,
                )}
                categoryAccessibilityLabel={category.title}
                money={Money.of(row.currency, row.amountMinorUnits)}
                footerMeta={`${accountDisplayName(
                  {
                    kind: row.accountKind,
                    name: row.accountName,
                    archivedAt: row.accountArchivedAt,
                  },
                  t,
                )} · ${category.title}`}
                footerTrailing={formatDate(row.time)}
                loanLinked={row.loanHoldingId !== null}
                style={styles.chargeCard}
                testID={`recurring-series-charge-${row.id}`}
              />
            </Pressable>
          );
        }}
        ListHeaderComponent={
          <>
            <LargeTitleHeading />

            {series !== undefined && (
              <Box style={styles.header} testID="recurring-series-header">
                <SummaryTable
                  rows={[
                    {
                      key: 'repeats',
                      label: t('recurringCharges.summary.repeats'),
                      value: (
                        <Text variant="body">
                          {recurrenceLine(series.period, series.recurrence, t)}
                        </Text>
                      ),
                      testID: 'recurring-series-summary-repeats',
                      wraps: true,
                    },
                    {
                      key: 'lastCharge',
                      label: t('recurringCharges.summary.lastCharge'),
                      value: <Text variant="body">{formatDate(series.lastChargeTime)}</Text>,
                      testID: 'recurring-series-summary-last-charge',
                    },
                    ...(series.isStopped
                      ? [
                          {
                            key: 'status',
                            label: t('recurringCharges.summary.status'),
                            value: <Text variant="body">{statusTextOf(series, t)}</Text>,
                            testID: 'recurring-series-summary-status',
                            wraps: true,
                          } as const,
                        ]
                      : []),
                    {
                      key: 'chargeCount',
                      label: t('recurringCharges.summary.chargeCount'),
                      value: <Text variant="body">{series.chargeIds.length}</Text>,
                      testID: 'recurring-series-summary-charge-count',
                    },
                    // Only once the rows have landed: the sum of a half-read list would be wrong.
                    ...(rowsLoading
                      ? []
                      : [
                          {
                            key: 'paid',
                            label: t('recurringCharges.paidSoFar'),
                            value: <MoneyText money={paidSoFarOf(series, charges)} />,
                            testID: 'recurring-series-summary-paid',
                          },
                        ]),
                  ]}
                />
              </Box>
            )}
          </>
        }
        ListEmptyComponent={emptyComponent}
        {...headingScrollProps}
        contentInsetAdjustmentBehavior="automatic"
        {...scrollIndicatorProps}
        style={styles.list}
        contentContainerStyle={(floatingFooterEnd) => [
          styles.listContent(bottomClearance, contentMargin, floatingFooterEnd),
          contentCap,
        ]}
      />
    </Screen>
  );
};

export default RecurringSeriesScreen;

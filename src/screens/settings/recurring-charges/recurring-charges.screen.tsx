import { match } from 'ts-pattern';
import { FlatList } from 'react-native';
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Screen, {
  useContentCap,
  useContentMargin,
  useScrollIndicatorProps,
  useAutomaticScrollClearance,
} from '@kiko/design-system/components/screen';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { useOpenInPane } from '@kiko/navigation/pane-stack';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { useRecurringSeries } from '@kiko/recurring/use-recurring-series';
import { type RecurringMerchantChoice, settingsRepo } from '@kiko/settings';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { compareText, type RecurringSeries } from '@kiko/recurring/detection';

import { styles } from './recurring-charges.styles';
import RecurringSeriesRow from './recurring-series-row';

type RecurringChargesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'RecurringCharges'
>;

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;

// Flat rows, not a `SectionList`, so the list stays the first scroll view the large title tracks.
// The empty item stands in the flow, not in `ListEmptyComponent`, since the hidden section can
// follow it.
type ListItem =
  | { kind: 'heading'; section: 'stopped' | 'hidden' }
  | { kind: 'series'; series: RecurringSeries }
  | { kind: 'hidden'; key: string; name: string }
  | { kind: 'empty' };

const STOPPED_HEADING_ITEM: ListItem = { kind: 'heading', section: 'stopped' };

const HIDDEN_HEADING_ITEM: ListItem = { kind: 'heading', section: 'hidden' };

const EMPTY_ITEM: ListItem = { kind: 'empty' };

// Within a section: the newest last charge first, then the merchant key, then the series id. Never
// by amount, which one section can hold in several currencies.
const newestChargeFirst = (left: RecurringSeries, right: RecurringSeries): number =>
  right.lastChargeTime - left.lastChargeTime ||
  compareText(left.merchantKey, right.merchantKey) ||
  compareText(left.id, right.id);

const seriesItem = (series: RecurringSeries): ListItem => ({ kind: 'series', series });

// The flag is tested, not the key's presence: an entry that does not say hidden hides nothing.
const hiddenEntriesOf = (choices: Choices): [string, RecurringMerchantChoice][] =>
  [...choices]
    .filter(([, choice]) => choice.hidden === true)
    .sort(([left], [right]) => compareText(left, right));

// A hidden merchant lists with no series behind it, since its name is the way back.
const hiddenItemsOf = (choices: Choices): ListItem[] => {
  const hidden = hiddenEntriesOf(choices);

  return hidden.length > 0
    ? [
        HIDDEN_HEADING_ITEM,
        ...hidden.map(([key, { name }]): ListItem => ({ kind: 'hidden', key, name })),
      ]
    : [];
};

const itemsOf = (series: readonly RecurringSeries[], choices: Choices): ListItem[] => {
  const ordered = [...series]
    .filter(({ merchantKey }) => choices.get(merchantKey)?.hidden !== true)
    .sort(newestChargeFirst);
  const stopped = ordered.filter(({ isStopped }) => isStopped);

  return [
    ...(ordered.length > 0 ? [] : [EMPTY_ITEM]),
    ...ordered.filter(({ isStopped }) => !isStopped).map(seriesItem),
    ...(stopped.length > 0 ? [STOPPED_HEADING_ITEM, ...stopped.map(seriesItem)] : []),
    ...hiddenItemsOf(choices),
  ];
};

const keyOf = (item: ListItem): string =>
  match(item)
    .with({ kind: 'heading' }, ({ section }) => `heading-${section}`)
    .with({ kind: 'series' }, ({ series }) => series.id)
    .with({ kind: 'hidden' }, ({ key }) => `hidden-${key}`)
    .with({ kind: 'empty' }, () => 'empty')
    .exhaustive();

// Every charge that repeated in the user's own rows. The list stays mounted while the read is
// queued (`bleedTop` and the automatic inset apply from the first render) and shows the loading
// state in place of its rows, never the empty state or the hidden section.
const RecurringChargesScreen: FC<RecurringChargesScreenProps> = () => {
  const { t } = useTranslation();
  const { series, choices, isLoading } = useRecurringSeries();
  const headingScrollProps = useLargeTitleScroll();
  const bottomClearance = useAutomaticScrollClearance();
  const contentMargin = useContentMargin();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();
  const openInPane = useOpenInPane();
  // The route holds what a later read needs to find the series again, since its id is its earliest
  // charge's and an older import moves that.
  const openSeries = useCallback(
    ({ id, merchantKey, currency, period, name }: RecurringSeries): void => {
      openInPane('RecurringSeries', { seriesId: id, merchantKey, currency, period, name });
    },
    [openInPane],
  );
  // Taking a hide back is idempotent, so a second tap needs no guard; the row goes with the write.
  const showAgain = useCallback(
    async (key: string): Promise<void> => {
      try {
        await settingsRepo.showRecurringMerchantAgain(key);
      } catch {
        alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
      }
    },
    [t],
  );

  return (
    <Screen bleedTop>
      <FlatList
        data={isLoading ? [] : itemsOf(series, choices)}
        keyExtractor={keyOf}
        renderItem={({ item }) =>
          match(item)
            .with({ kind: 'heading', section: 'stopped' }, () => (
              <Box testID="recurring-charges-heading-stopped">
                <Text variant="heading">{t('recurringCharges.stoppedHeading')}</Text>
              </Box>
            ))
            .with({ kind: 'heading', section: 'hidden' }, () => (
              <Box testID="recurring-charges-heading-hidden">
                <Text variant="heading">{t('recurringCharges.hiddenHeading')}</Text>
              </Box>
            ))
            .with({ kind: 'series' }, ({ series: listed }) => (
              <RecurringSeriesRow series={listed} onPress={openSeries} />
            ))
            .with({ kind: 'hidden' }, ({ key, name }) => (
              <Card padding={3}>
                <Box direction="row" style={styles.hiddenRow}>
                  <Box style={styles.hiddenName} testID={`recurring-charges-hidden-${key}`}>
                    <Text variant="body">{name}</Text>
                  </Box>

                  <Button
                    variant="secondaryTonal"
                    size="small"
                    fullWidth={false}
                    onPress={() => showAgain(key)}
                    testID={`recurring-charges-show-again-${key}`}
                  >
                    {t('recurringCharges.showAgain')}
                  </Button>
                </Box>
              </Card>
            ))
            .with({ kind: 'empty' }, () => (
              <EmptyState
                icon={entrySymbol.recurringCharges}
                title={t('recurringCharges.emptyTitle')}
                message={t('recurringCharges.emptyMessage')}
                testID="recurring-charges-empty"
              />
            ))
            .exhaustive()
        }
        ListHeaderComponent={<LargeTitleHeading />}
        ListEmptyComponent={
          isLoading ? <LoadingState testID="recurring-charges-loading" /> : undefined
        }
        {...headingScrollProps}
        contentInsetAdjustmentBehavior="automatic"
        {...scrollIndicatorProps}
        style={styles.list}
        contentContainerStyle={[styles.listContent(bottomClearance, contentMargin), contentCap]}
      />
    </Screen>
  );
};

export default RecurringChargesScreen;

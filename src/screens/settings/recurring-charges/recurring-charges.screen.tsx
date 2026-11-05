import type { FC } from 'react';
import { match } from 'ts-pattern';
import { FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import Screen, {
  useContentCap,
  useContentMargin,
  useScrollIndicatorProps,
  useAutomaticScrollClearance,
} from '@kiko/design-system/components/screen';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { useRecurringSeries } from '@kiko/recurring/use-recurring-series';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { compareText, type RecurringSeries } from '@kiko/recurring/detection';

import { styles } from './recurring-charges.styles';
import RecurringSeriesRow from './recurring-series-row';

type RecurringChargesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'RecurringCharges'
>;

// Flat rows, not a `SectionList`, so the list stays the first scroll view the large title tracks.
type ListItem = { kind: 'heading' } | { kind: 'series'; series: RecurringSeries };

const HEADING_ITEM: ListItem = { kind: 'heading' };

// Within a section: the newest last charge first, then the merchant key, then the series id. Never
// by amount, which one section can hold in several currencies.
const newestChargeFirst = (left: RecurringSeries, right: RecurringSeries): number =>
  right.lastChargeTime - left.lastChargeTime ||
  compareText(left.merchantKey, right.merchantKey) ||
  compareText(left.id, right.id);

const seriesItem = (series: RecurringSeries): ListItem => ({ kind: 'series', series });

const itemsOf = (series: readonly RecurringSeries[]): ListItem[] => {
  const ordered = [...series].sort(newestChargeFirst);
  const stopped = ordered.filter(({ isStopped }) => isStopped);

  return [
    ...ordered.filter(({ isStopped }) => !isStopped).map(seriesItem),
    ...(stopped.length > 0 ? [HEADING_ITEM, ...stopped.map(seriesItem)] : []),
  ];
};

const keyOf = (item: ListItem): string =>
  match(item)
    .with({ kind: 'heading' }, () => 'heading-stopped')
    .with({ kind: 'series' }, ({ series }) => series.id)
    .exhaustive();

// Every charge that repeated in the user's own rows. The list stays mounted while the read is
// queued (`bleedTop` and the automatic inset apply from the first render) and shows the loading
// state in place of its rows, never the empty state.
const RecurringChargesScreen: FC<RecurringChargesScreenProps> = () => {
  const { t } = useTranslation();
  const { series, isLoading } = useRecurringSeries();
  const headingScrollProps = useLargeTitleScroll();
  const bottomClearance = useAutomaticScrollClearance();
  const contentMargin = useContentMargin();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();

  return (
    <Screen bleedTop>
      <FlatList
        data={isLoading ? [] : itemsOf(series)}
        keyExtractor={keyOf}
        renderItem={({ item }) =>
          match(item)
            .with({ kind: 'heading' }, () => (
              <Box testID="recurring-charges-heading-stopped">
                <Text variant="heading">{t('recurringCharges.stoppedHeading')}</Text>
              </Box>
            ))
            .with({ kind: 'series' }, ({ series: listed }) => (
              <RecurringSeriesRow series={listed} />
            ))
            .exhaustive()
        }
        ListHeaderComponent={<LargeTitleHeading />}
        ListEmptyComponent={
          isLoading ? (
            <LoadingState testID="recurring-charges-loading" />
          ) : (
            <EmptyState
              icon={entrySymbol.recurringCharges}
              title={t('recurringCharges.emptyTitle')}
              message={t('recurringCharges.emptyMessage')}
              testID="recurring-charges-empty"
            />
          )
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

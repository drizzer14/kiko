import { match } from 'ts-pattern';
import { minOf } from '@kiko/numbers';
import { FlatList } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import Screen, {
  useContentCap,
  useContentMargin,
  useScrollIndicatorProps,
  useAutomaticScrollClearance,
} from '@kiko/design-system/components/screen';
import type { Money } from '@kiko/currency/money';
import Box from '@kiko/design-system/components/box';
import { type FC, useCallback, useMemo } from 'react';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { useOpenInPane } from '@kiko/navigation/pane-stack';
import { entrySymbol } from '@kiko/navigation/entry-symbols';
import Divider from '@kiko/design-system/components/divider';
import { recurrenceLine } from '@kiko/recurring/recurrence-text';
import type { MarkedChain } from '@kiko/recurring/marked-series';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import MoneyText from '@kiko/design-system/components/money-text';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import type { RecurringGroup } from '@kiko/recurring/recurring-groups';
import LoadingState from '@kiko/design-system/components/loading-state';
import { useRecurringGroups } from '@kiko/recurring/use-recurring-groups';
import { useRecurringSeries } from '@kiko/recurring/use-recurring-series';
import { type RecurringMerchantChoice, settingsRepo } from '@kiko/settings';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { compareText, type RecurringSeries } from '@kiko/recurring/detection';

import { styles } from './recurring-charges.styles';
import RecurringSeriesRow from './recurring-series-row';
import RecurringGroupHeading from './recurring-group-heading';

type RecurringChargesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'RecurringCharges'
>;

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;

// Flat rows, not a `SectionList`, so the list stays the first scroll view the large title tracks.
// The empty item stands in the flow, not in `ListEmptyComponent`, since the marked and hidden
// sections can follow it.
type ListItem =
  | { kind: 'total'; total: Money }
  | { kind: 'divider'; before: string }
  | { kind: 'group'; group: RecurringGroup }
  | { kind: 'heading'; section: 'markedEmpty' | 'hidden' }
  | { kind: 'series'; series: RecurringSeries }
  | { kind: 'markedEmpty'; chain: MarkedChain }
  | { kind: 'hidden'; key: string; name: string }
  | { kind: 'empty' };

const MARKED_EMPTY_HEADING_ITEM: ListItem = { kind: 'heading', section: 'markedEmpty' };

const HIDDEN_HEADING_ITEM: ListItem = { kind: 'heading', section: 'hidden' };

const EMPTY_ITEM: ListItem = { kind: 'empty' };

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

const markedEmptyItemsOf = (withoutCharges: readonly MarkedChain[]): ListItem[] =>
  withoutCharges.length > 0
    ? [
        MARKED_EMPTY_HEADING_ITEM,
        ...withoutCharges.map((chain): ListItem => ({ kind: 'markedEmpty', chain })),
      ]
    : [];

// A hide leaves out detected series only: a marked series is the user's own word and stays listed.
const shownSeriesOf = (
  series: readonly RecurringSeries[],
  markedSeries: readonly RecurringSeries[],
  choices: Choices,
): RecurringSeries[] => [
  ...series.filter(({ merchantKey }) => choices.get(merchantKey)?.hidden !== true),
  ...markedSeries,
];

// A chain is told apart by its key, currency and lowest stored amount; the amount is never shown.
const chainIdOf = ({ key, currency, marks }: MarkedChain): string =>
  JSON.stringify([key, currency, marks[0].amountMinorUnits]);

const keyOf = (item: ListItem): string =>
  match(item)
    .with({ kind: 'total' }, () => 'total')
    .with({ kind: 'divider' }, ({ before }) => `divider-${before}`)
    .with({ kind: 'group' }, ({ group }) => `group-${group.key}`)
    .with({ kind: 'heading' }, ({ section }) => `heading-${section}`)
    .with({ kind: 'series' }, ({ series }) => series.id)
    .with({ kind: 'markedEmpty' }, ({ chain }) => `marked-empty-${chainIdOf(chain)}`)
    .with({ kind: 'hidden' }, ({ key }) => `hidden-${key}`)
    .with({ kind: 'empty' }, () => 'empty')
    .exhaustive();

// A divider stands before every group and section that follows another item, so the sections
// read apart; the first item has none before it.
const withDividers = (sections: readonly ListItem[][]): ListItem[] =>
  sections
    .filter((section) => section.length > 0)
    .flatMap((section, index): ListItem[] =>
      index === 0 ? section : [{ kind: 'divider', before: keyOf(section[0]) }, ...section],
    );

const itemsOf = (
  shown: readonly RecurringSeries[],
  { groups, total }: Pick<ReturnType<typeof useRecurringGroups>, 'groups' | 'total'>,
  withoutCharges: readonly MarkedChain[],
  choices: Choices,
): ListItem[] =>
  withDividers([
    shown.length > 0 ? [] : [EMPTY_ITEM],
    foldMap(maybe(total), (paid): ListItem[] => [{ kind: 'total', total: paid }]) ?? [],
    ...groups.map((group): ListItem[] => [
      { kind: 'group', group },
      ...group.series.map(seriesItem),
    ]),
    markedEmptyItemsOf(withoutCharges),
    hiddenItemsOf(choices),
  ]);

// Every charge that repeated in the user's own rows. The list stays mounted while the read is
// queued (`bleedTop` and the automatic inset apply from the first render) and shows the loading
// state in place of its rows, never the empty state or the hidden section.
const RecurringChargesScreen: FC<RecurringChargesScreenProps> = () => {
  const { t } = useTranslation();
  const { series, markedSeries, withoutCharges, choices, isLoading } = useRecurringSeries();
  const shown = useMemo(
    () => shownSeriesOf(series, markedSeries, choices),
    [series, markedSeries, choices],
  );
  // Every series, a hidden one included, so hiding one leaves the groups' read keys unchanged.
  const every = useMemo(() => [...series, ...markedSeries], [series, markedSeries]);
  const { groups, total, isLoading: groupsLoading } = useRecurringGroups(shown, every);
  const isBusy = isLoading || groupsLoading;
  const headingScrollProps = useLargeTitleScroll();
  const bottomClearance = useAutomaticScrollClearance();
  const contentMargin = useContentMargin();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();
  const openInPane = useOpenInPane();
  // The route holds what a later read needs to find the series again, since its id is its earliest
  // charge's and an older import moves that. A marked series also holds its lowest stored amount,
  // which finds its piece again whatever its id or period became.
  const openSeries = useCallback(
    ({ id, merchantKey, currency, period, name, marks }: RecurringSeries): void => {
      openInPane('RecurringSeries', {
        seriesId: id,
        merchantKey,
        currency,
        period,
        name,
        ...foldMap(maybe(marks), (stored) => ({
          markedAmountMinorUnits: minOf(stored.map(({ amountMinorUnits }) => amountMinorUnits)),
        })),
      });
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
  // Removing marks is idempotent too: one that is already gone writes nothing.
  const removeMarks = useCallback(
    async ({ key, marks }: MarkedChain): Promise<void> => {
      try {
        await settingsRepo.removeRecurringMarks(key, marks);
      } catch {
        alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
      }
    },
    [t],
  );

  return (
    <Screen bleedTop>
      <FlatList
        data={isBusy ? [] : itemsOf(shown, { groups, total }, withoutCharges, choices)}
        keyExtractor={keyOf}
        renderItem={({ item }) =>
          match(item)
            .with({ kind: 'total' }, ({ total: paid }) => (
              <Box direction="row" testID="recurring-charges-total" style={styles.totalRow}>
                <Box style={styles.totalLabel}>
                  <Text variant="body">{t('recurringCharges.paidSoFar')}</Text>
                </Box>

                <Box style={styles.totalAmount}>
                  <MoneyText money={paid} />
                </Box>
              </Box>
            ))
            .with({ kind: 'divider' }, ({ before }) => (
              <Divider spacing={2} testID={`recurring-charges-divider-${before}`} />
            ))
            .with({ kind: 'group' }, ({ group }) => (
              <RecurringGroupHeading
                title={group.title}
                icon={group.icon}
                color={group.color}
                total={group.total}
                testID={`recurring-charges-group-${group.key}`}
                totalTestID={`recurring-charges-group-total-${group.key}`}
              />
            ))
            .with({ kind: 'heading', section: 'markedEmpty' }, () => (
              <Box testID="recurring-charges-heading-marked-empty">
                <Text variant="heading">{t('recurringCharges.markedEmptyHeading')}</Text>
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
            .with({ kind: 'markedEmpty' }, ({ chain }) => (
              <Card padding={3}>
                <Box direction="row" style={styles.entryRow}>
                  <Box
                    gap={1}
                    style={styles.entryName}
                    testID={`recurring-charges-marked-empty-${chainIdOf(chain)}`}
                  >
                    <Text variant="body">{chain.name}</Text>

                    <Text variant="caption" tone="textSecondary">
                      {recurrenceLine(chain.period, { kind: 'marked' }, t)}
                    </Text>

                    <Text variant="caption" tone="textSecondary">
                      {t('recurringCharges.markedEmptyMessage')}
                    </Text>
                  </Box>

                  <Button
                    variant="secondaryTonal"
                    size="small"
                    fullWidth={false}
                    onPress={() => removeMarks(chain)}
                    testID={`recurring-charges-remove-mark-${chainIdOf(chain)}`}
                  >
                    {t('recurringCharges.removeMark')}
                  </Button>
                </Box>
              </Card>
            ))
            .with({ kind: 'hidden' }, ({ key, name }) => (
              <Card padding={3}>
                <Box direction="row" style={styles.entryRow}>
                  <Box style={styles.entryName} testID={`recurring-charges-hidden-${key}`}>
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
          isBusy ? <LoadingState testID="recurring-charges-loading" /> : undefined
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

import type { FC } from 'react';
import { Pressable } from 'react-native';
import {
  type TransactionTemplate,
  toTransactionTemplate,
  transactionTemplatesRepo,
} from '@kiko/transaction-templates/repo';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  neutralCategory,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { useUnistyles } from 'react-native-unistyles';
import { categoriesRepo } from '@kiko/categories/repo';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import TransactionCard from '@kiko/design-system/components/transaction-card';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';

import { styles } from './transaction-templates.styles';

type TransactionTemplatesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'TransactionTemplates'
>;

// A template shows an amount only when it stores both the amount and its currency; an amount
// alone has no currency to read it in.
const storedMoney = ({ draft }: TransactionTemplate): Money | undefined =>
  foldMap(maybe(draft.currency), (currency) =>
    foldMap(maybe(draft.amountMinorUnits), (minorUnits) => Money.of(currency, minorUnits)),
  );

const TransactionTemplatesScreen: FC<TransactionTemplatesScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const liveOptions = { cached: true } as const;
  const { data: rows, isLoading: templatesLoading } = useLiveQuery(
    transactionTemplatesRepo.listQuery(),
    ['transaction_templates'],
    true,
    liveOptions,
  );
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    true,
    liveOptions,
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    liveOptions,
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  // The empty state must never show while any of these reads is on its first load
  // (kiko-architecture's useLiveQuery consumer rule): `rows.length === 0` alone is also what a
  // read that has not landed yet looks like.
  const isReady = useDataReady(
    templatesLoading,
    holdingsLoading,
    categoriesLoading,
    settingsLoading,
  );

  if (!isReady) {
    return (
      <Screen scroll>
        <LoadingState testID="transaction-templates-loading" />
      </Screen>
    );
  }

  const templates = rows.map(toTransactionTemplate);
  const holdingNameById = new Map(holdings.map((holding) => [holding.id, holding.name]));
  const categoryByKey = buildCategoryDisplayMap(categories);
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const isEmpty = templates.length === 0;

  const addTemplate = (): void => navigation.navigate('TransactionForm', { newTemplate: true });

  const renderCard = (template: TransactionTemplate) => {
    const { draft } = template;
    // A template with no category shows the neutral tile, not the default category's: it has
    // none, and the default is what a transaction with none is filed under.
    const category =
      draft.category === null
        ? neutralCategory()
        : resolveCategoryDisplay(draft.category, categoryByKey, defaultCategoryKey);
    const categoryColor =
      draft.category === null
        ? theme.colors.textSecondary
        : resolveCategoryColor(
            category.color,
            resolveCategoryKey(draft.category, categoryByKey, defaultCategoryKey),
          );
    const typeLabel = t(`forms.transaction.${draft.mode}`);
    const holdingName = foldMap(maybe(draft.holdingId), (holdingId) =>
      holdingNameById.get(holdingId),
    );
    const openForEdit = (): void =>
      navigation.navigate('TransactionForm', { editTemplateId: template.id });

    return (
      <CardContextMenu
        key={template.id}
        name={template.name}
        deletable
        onEdit={openForEdit}
        onDelete={() => transactionTemplatesRepo.remove(template.id)}
        liftOnHold
      >
        <Pressable accessibilityRole="button" onPress={openForEdit}>
          <TransactionCard
            title={template.name}
            categoryIcon={category.icon}
            categoryIconColor={categoryColor}
            categoryAccessibilityLabel={category.title}
            money={storedMoney(template)}
            footerMeta={
              foldMap(maybe(holdingName), (name) => `${name} · ${typeLabel}`) ?? typeLabel
            }
            testID="transaction-template-card"
          />
        </Pressable>
      </CardContextMenu>
    );
  };

  return (
    <Screen
      scroll
      // The empty state carries its own Add template action, so the pinned footer would show
      // the same button twice.
      footer={
        isEmpty ? undefined : (
          <Box testID="add-template-footer" style={styles.addTemplateButton}>
            <Button variant="primary" onPress={addTemplate} icon={genericEntitySymbol.template}>
              {t('transactionTemplates.addTemplate')}
            </Button>
          </Box>
        )
      }
    >
      <Box gap={2} style={styles.content}>
        {isEmpty ? (
          <Box style={styles.empty}>
            <EmptyState
              icon={genericEntitySymbol.template}
              title={t('transactionTemplates.empty.title')}
              message={t('transactionTemplates.empty.message')}
              action={{
                label: t('transactionTemplates.addTemplate'),
                icon: genericEntitySymbol.template,
                onPress: addTemplate,
              }}
              testID="transaction-templates-empty"
            />
          </Box>
        ) : (
          templates.map(renderCard)
        )}
      </Box>
    </Screen>
  );
};

export default TransactionTemplatesScreen;

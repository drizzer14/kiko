import { type FC, useEffect, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '../../categories/category-display';
import { type Currency, currencyScale } from '../../currency/currency';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import { useLiveQuery } from '../../db/use-live-query';
import BottomSheet from '../../design-system/components/bottom-sheet';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import TextField from '../../design-system/components/text-field';
import type { TransactionFormParams } from '../../navigation/types';
import { categoriesRepo } from '../../repositories/categories.repo';
import { categoryOverridesRepo } from '../../repositories/category-overrides.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { resolveCategoryColor } from '../../statistics/category-breakdown';

import { groupAmount } from './amount-format';
import CategoryField from './category-field';
import ChipRow from './chip-row';
import DateField from './date-field';

// This screen is registered in BOTH the Home and Accounts stacks (Home lists
// every transaction; Accounts reaches it from a holding), so it cannot bind its
// props to a single stack's param list. It only needs the route params and two
// navigation methods, so it declares exactly that minimal shape — structurally
// satisfied by either stack's generated props.
type TransactionFormScreenProps = {
  route: { params: TransactionFormParams };
  navigation: { goBack: () => void; setOptions: (options: { title: string }) => void };
};

type Sign = 'income' | 'expense';

const SIGN_OPTIONS: readonly Sign[] = ['income', 'expense'];

const SIGN_LABELS: Record<Sign, string> = { income: 'Income', expense: 'Expense' };

// The message shown on a synced row: its amount is owned by the bank import, so
// the form opens read-only rather than pretending an edit would stick.
const MONOBANK_NOTICE = 'This transaction was imported from Monobank and cannot be edited.';

// The header title reflects the mode: a synced row is a plain read-only view, an
// existing manual row is an edit, and no id at all is a fresh add.
const headerTitle = (isReadOnly: boolean, isEditing: boolean): string => {
  if (isReadOnly) {
    return 'Transaction';
  }

  return isEditing ? 'Edit Transaction' : 'Add Transaction';
};

const signedMinorUnits = (currency: Currency, amount: string, sign: Sign): number => {
  const magnitude = Money.fromMajor(currency, parseAmount(amount));

  return sign === 'expense' ? -magnitude.minorUnits : magnitude.minorUnits;
};

// Present a stored (signed) minor-units amount as the unsigned major string the
// Amount input shows, pairing it with the sign chip the amount's polarity maps
// to. Kept pure so the hydration effect below stays a one-liner.
const toAmountFields = (
  currency: Currency,
  amountMinorUnits: number,
): { amount: string; sign: Sign } => {
  const factor = 10 ** currencyScale[currency];

  return {
    amount: (Math.abs(amountMinorUnits) / factor).toString(),
    sign: amountMinorUnits < 0 ? 'expense' : 'income',
  };
};

// Resolve the pending override's category into the icon name and the confirm
// copy the "Apply Category to All" sheet shows. The sheet renders the glyph
// white (textPrimary), not its category color, so only the icon name is needed
// here. Kept module-level so its null branch stays out of the screen
// component's cognitive-complexity budget.
type PendingCategoryView = { icon: string; message: string };

const resolvePendingCategory = (
  pendingOverride: { name: string; category: string } | null,
  categoryByKey: Parameters<typeof resolveCategoryDisplay>[1],
): PendingCategoryView | null => {
  if (pendingOverride === null) {
    return null;
  }

  // `pendingOverride.category` is always a user-PICKED, valid category key, so
  // the default-category fallback is never consulted here — the shared constant
  // is passed only to satisfy the resolver's signature (no settings read needed).
  const display = resolveCategoryDisplay(
    pendingOverride.category,
    categoryByKey,
    DEFAULT_CATEGORY_KEY,
  );

  return {
    icon: display.icon,
    message: `Apply “${display.title}” to all transactions named “${pendingOverride.name.trim()}”? This also applies to future imports.`,
  };
};

const TransactionFormScreen: FC<TransactionFormScreenProps> = ({ route, navigation }) => {
  const { theme } = useUnistyles();
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the detail screen uses.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);

  // Two entry points: `holdingId` = add a new manual row; `transactionId` = open
  // an existing one. In add mode the by-id query runs against an empty id and
  // returns nothing, keeping the hook order stable without a conditional call.
  const editingId = 'transactionId' in route.params ? route.params.transactionId : null;
  const { data: matchedTransactions } = useLiveQuery(
    transactionsRepo.getByIdQuery(editingId ?? ''),
    ['transactions'],
  );
  const existing = editingId ? matchedTransactions.at(0) : undefined;

  // The category picker's options come from the categories live query (a rename
  // flows straight through), and the confirm copy resolves the picked key to its
  // display title through the same map every screen uses.
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const categoryOptions = categories.map((category) => ({
    key: category.key,
    title: category.title,
    icon: category.icon,
    color: resolveCategoryColor(category.color, category.key),
  }));
  const categoryByKey = buildCategoryDisplayMap(categories);

  const holdingId =
    existing?.holdingId ?? ('holdingId' in route.params ? route.params.holdingId : undefined);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  const isReadOnly = existing?.source === 'monobank';
  // `editingId` is known synchronously from the route params, so the header
  // reads "Edit Transaction" immediately instead of flashing "Add Transaction"
  // until the row loads. Read-only still keys off the loaded `source`.
  const isEditing = editingId != null;

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [sign, setSign] = useState<Sign>('income');
  // The transaction's time, defaulting to now for a fresh add so a manual row
  // can be BACKDATED via the DateField below. Edit mode hydrates the existing
  // time; picking a day sets it to that day's local midnight.
  const [time, setTime] = useState<number>(() => Date.now());
  // The picked category key (a categories.key slug, lowercase). Null = no
  // category yet. Editing it ALWAYS propagates to every same-name transaction
  // via the override rule — there is no single-row-only category edit.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // The pending category-override confirmation. Non-null while the themed
  // confirm modal is up (carrying the affected name + picked category key);
  // null when no confirmation is in flight.
  const [pendingOverride, setPendingOverride] = useState<{
    name: string;
    category: string;
  } | null>(null);

  // Seed the fields once, when BOTH the transaction and its holding have loaded
  // (the holding's currency scale is needed to render the amount). The `hydrated`
  // latch keeps a later live-query refresh from clobbering in-progress edits.
  useEffect(() => {
    if (existing && holding && !hydrated) {
      const fields = toAmountFields(currency, existing.amountMinorUnits);
      setAmount(groupAmount(fields.amount));
      setSign(fields.sign);
      setDescription(existing.description);
      setTime(existing.time);
      // Lowercase the stored value to a slug key — the same normalization the
      // display resolver applies — so it lines up with the picker's option keys.
      setSelectedCategory(existing.category ? existing.category.toLowerCase() : null);
      setHydrated(true);
    }
  }, [existing, holding, hydrated, currency]);

  // The row's category at open, keyed the same way, so an edit is detectable.
  // Derived (not stored) so it always reflects the persisted value even before
  // the hydration latch closes.
  const originalCategoryKey = existing?.category ? existing.category.toLowerCase() : null;
  const categoryChanged = selectedCategory !== null && selectedCategory !== originalCategoryKey;

  const title = headerTitle(isReadOnly, isEditing);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  // Persist the amount/description edit on a manual row (edit vs. add), leaving
  // the category to the always-propagating override path below.
  const writeManual = async (): Promise<void> => {
    const amountMinorUnits = signedMinorUnits(currency, amount, sign);

    if (editingId) {
      await transactionsRepo.update({
        transactionId: editingId,
        amountMinorUnits,
        time,
        description,
      });

      return;
    }

    if (holdingId) {
      await transactionsRepo.recordManual({ holdingId, amountMinorUnits, time, description });
    }
  };

  // Editing a category ALWAYS propagates to every same-name transaction (and to
  // future imports), so surface the blast radius in a themed confirm modal
  // before writing the rule. Both paths return to the list (the manual edit, if
  // any, has already been written); only "Apply" also writes the override rule.
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }
    await categoryOverridesRepo.upsertCategoryOverride(
      pendingOverride.name,
      pendingOverride.category,
    );
    navigation.goBack();
  };

  const cancelOverride = (): void => {
    navigation.goBack();
  };

  // The picked category's resolved icon name + confirm copy for the sheet. The
  // sheet renders the glyph white (textPrimary), not its category color, by
  // design. Bundled by a module-level helper so the JSX gates on a single
  // nullable and the branch stays out of the component body.
  const pendingCategory = resolvePendingCategory(pendingOverride, categoryByKey);
  const overrideMessage = pendingCategory?.message ?? '';

  const save = async (): Promise<void> => {
    // A synced row is bank-owned: only its category may change, so skip the
    // amount write entirely and fall through to the category confirm below.
    if (!isReadOnly) {
      // Guard: reject an empty or non-numeric amount — no zero-amount row.
      if (amount.trim() === '' || Number.isNaN(parseAmount(amount))) {
        return;
      }

      await writeManual();
    }

    if (categoryChanged && selectedCategory !== null) {
      // The rule keys on the synced row's own description (read-only) or the
      // just-saved manual description.
      const name = isReadOnly ? (existing?.description ?? '') : description;
      setPendingOverride({ name, category: selectedCategory });

      return;
    }

    navigation.goBack();
  };

  // A manual row can be deleted; the confirm dialog guards the destructive write,
  // and only its "Delete" button runs the removal, then returns to the list.
  const confirmDelete = (): void => {
    if (editingId === null) {
      return;
    }
    Alert.alert('Delete Transaction', 'This transaction will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await transactionsRepo.remove(editingId);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <>
      <Screen
        scroll
        footer={!isReadOnly || categoryChanged ? <Button onPress={save}>Save</Button> : undefined}
      >
        <Box gap={4}>
          {isReadOnly && (
            <Box padding={3} style={[styles.notice, { backgroundColor: theme.colors.surfaceHigh }]}>
              <Text variant="caption" tone="textSecondary">
                {MONOBANK_NOTICE}
              </Text>
            </Box>
          )}

          <TextField
            label="Amount"
            value={amount}
            onChangeText={(text) => setAmount(groupAmount(text))}
            editable={!isReadOnly}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />

          <TextField
            label="Description"
            value={description}
            onChangeText={setDescription}
            editable={!isReadOnly}
            placeholder="Description"
          />

          <DateField label="Date" value={time} onChange={setTime} disabled={isReadOnly} />

          {/* Income/expense sign as a shared two-option chip row. On a read-only
            (synced) row the row is `disabled`: presses are inert AND the chips
            dim, matching how the Amount/Description/Date fields render locked, so
            a synced transaction's bank-owned sign cannot be toggled here. */}
          <ChipRow
            options={SIGN_OPTIONS}
            selected={sign}
            onSelect={setSign}
            labels={SIGN_LABELS}
            disabled={isReadOnly}
          />

          {/* The category picker is ALWAYS editable — even on a synced row — since
            a category edit propagates to every same-name transaction and to
            future imports (decision 3), unlike the bank-owned amount/sign. */}
          <CategoryField
            label="Category"
            options={categoryOptions}
            selectedKey={selectedCategory}
            onSelect={setSelectedCategory}
          />

          {isEditing && !isReadOnly && (
            <Button variant="destructive" size="compact" fullWidth={false} onPress={confirmDelete}>
              Delete
            </Button>
          )}
        </Box>
      </Screen>

      {/* The category-override confirmation, as a themed sheet rather than a
          native Alert (which cannot be styled). "Apply" is the accent-filled
          primary; "Cancel" is a transparent ghost with a red label. Dismissing
          the sheet (scrim/back) behaves like Cancel — it returns to the list. */}
      <BottomSheet
        visible={pendingOverride !== null}
        onDismiss={cancelOverride}
        gap={3}
        testID="category-override-sheet"
      >
        <Box direction="row" gap={2} style={styles.confirmHeader}>
          {pendingCategory !== null && (
            <SymbolIcon name={pendingCategory.icon} size={22} tone="textPrimary" />
          )}

          <Text variant="heading">Apply Category to All</Text>
        </Box>

        <Text variant="body" tone="textSecondary">
          {overrideMessage}
        </Text>

        <Button onPress={applyOverride}>Apply</Button>

        <Button variant="ghost" textColor={theme.colors.negative} onPress={cancelOverride}>
          Cancel
        </Button>
      </BottomSheet>
    </>
  );
};

const styles = StyleSheet.create((theme) => ({
  notice: {
    borderRadius: theme.radii.sm,
  },
  // Vertically centers the category glyph against the sheet's heading, so the
  // colored icon reads on the same baseline as "Apply Category to All".
  confirmHeader: {
    alignItems: 'center',
  },
}));

export default TransactionFormScreen;

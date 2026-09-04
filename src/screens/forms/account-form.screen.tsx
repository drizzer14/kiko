import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Currency, currencyOptions } from '../../currency/currency';
import { currencySignSymbol } from '../../currency/currency-symbols';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import TextField from '../../design-system/components/text-field';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';
import { groupAmount } from './amount-format';
import ChipRow from './chip-row';
import ColorPicker from './color-picker';
import HoldingIdentityField from './holding-identity-field';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

// The account kinds offered in this form (a subset of the `kind` enum in
// db/schema.ts). A crypto account is created like a bank account — no initial
// holding/currency at creation; holdings are added later — so only cash needs
// the currency + initial-value fields below.
const kinds = ['bank', 'cash', 'crypto'] as const;
type Kind = (typeof kinds)[number];

// Human display text for the account kinds; the chip still reports the
// underlying value on select.
const KIND_LABELS: Record<Kind, string> = {
  bank: 'Bank',
  cash: 'Cash',
  crypto: 'Crypto',
};

// Neutral placeholder glyph shown in the create form's icon chip until the user
// picks one. The persisted default (a kind-derived icon) is applied by the
// account list rows when the stored icon is null; here the account has no kind
// context worth deriving from yet, so a neutral swatch reads as "unset".
const FALLBACK_ICON = 'square.grid.2x2';

const AccountFormScreen: FC<AccountFormScreenProps> = ({ route, navigation }) => {
  // An `accountId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing account, saving through the update path
  // rather than create. Absent (the accounts list passes `{}`), it is a plain
  // create form.
  const editId = route.params?.accountId;
  const isEdit = editId !== undefined;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('bank');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  // Mirrors the icon's dirty pattern: null until the user taps a swatch. While
  // null, the effective color follows the selected kind's default
  // (defaultAccountColor[kind]) — the ColorPicker highlights that swatch and
  // switching kind moves it; once picked, the choice sticks.
  const [color, setColor] = useState<string | null>(null);
  const effectiveColor = color ?? defaultAccountColor[kind];

  // In edit mode, load the account being edited so its fields can seed the form.
  // The query always runs (hooks can't be conditional); an empty id in create
  // mode simply matches no row.
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(editId ?? ''), ['accounts']);
  const editingAccount = isEdit ? accounts.at(0) : undefined;

  // Seed the form once from the loaded account. `useLiveQuery` resolves
  // asynchronously, so the initial render precedes the data; a one-shot ref
  // guards against re-seeding (and clobbering the user's in-progress edits) on
  // every subsequent live-query emission.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || hydrated.current || editingAccount === undefined) {
      return;
    }
    hydrated.current = true;
    setName(editingAccount.name);
    setKind(editingAccount.kind);
    setIcon(editingAccount.icon);
    setColor(editingAccount.color);
  }, [isEdit, editingAccount]);

  // The stack sets the static "Add Account" title; in edit mode override it with
  // "Edit Account" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: 'Edit Account' });
    }
  }, [isEdit, navigation]);

  const trimmedName = name.trim();
  const canSave = trimmedName !== '';

  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; the button is also
    // disabled below so this guards the programmatic path too.
    if (!canSave) {
      return;
    }

    if (isEdit) {
      // Update the editable identity fields in one transaction; the icon routes
      // through setIcon (so a cleared icon persists an explicit null), the same
      // split the create path uses. Kind is read-only, and the cash currency +
      // initial value belong to the create-time initial holding, so neither is
      // touched here.
      await accountsRepo.update(editId, { name: trimmedName, color });
      await accountsRepo.setIcon(editId, icon);
      navigation.goBack();

      return;
    }

    if (kind === 'cash') {
      // Clamp a negative initial value to zero — a cash balance can never be
      // negative, and parseAmount('') is NaN so `|| 0` also covers a blank field.
      const initialMajor = Math.max(0, parseAmount(initialValue) || 0);
      await accountsRepo.createCashAccount({
        name: trimmedName,
        currency,
        initialBalanceMinorUnits: Money.fromMajor(currency, initialMajor).minorUnits,
        icon,
        color,
      });
      navigation.goBack();

      return;
    }

    // Persist the color only when the user picked one (dirty); left null, the row
    // follows its kind's default at display time, mirroring the icon fallback.
    const newAccountId = await accountsRepo.create({ name: trimmedName, kind, color });

    // Persist the chosen icon on the freshly-created row, using the id the
    // create resolved to. Awaited so it commits before navigating away.
    if (icon !== null) {
      await accountsRepo.setIcon(newAccountId, icon);
    }

    navigation.goBack();
  };

  return (
    <Screen
      scroll
      footer={
        <Button onPress={save} disabled={!canSave}>
          Save
        </Button>
      }
    >
      <Box gap={4}>
        {/* One shared icon+name block for every kind, cash included: the icon
            picker stays visible whatever the kind is. The cash create path
            (createCashAccount) now persists the picked icon in its own atomic
            insert, and the bank/crypto path sets it via setIcon on the returned
            id below. */}
        <HoldingIdentityField
          icon={icon}
          fallbackIcon={FALLBACK_ICON}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder="Name"
        />

        <ColorPicker label="Color" value={effectiveColor} onSelect={setColor} />

        {/* Kind fixes an account's structure (a cash account owns an initial
            cash holding; a bank/crypto does not), and no repo path re-shapes it,
            so it is read-only in edit mode — shown, but not switchable. */}
        <ChipRow
          label="Kind"
          options={kinds}
          selected={kind}
          onSelect={setKind}
          labels={KIND_LABELS}
          icons={accountKindSymbol}
          disabled={isEdit}
        />

        {/* The currency + initial value seed the cash account's initial holding
            at creation only; they have no meaning once the holding exists (its
            balance is edited on the holding itself), so the edit form omits
            them. */}
        {!isEdit && kind === 'cash' && (
          <>
            <ChipRow
              label="Currency"
              options={currencyOptions}
              selected={currency}
              onSelect={setCurrency}
              icons={currencySignSymbol}
            />

            <TextField
              label="Initial value"
              value={initialValue}
              onChangeText={(text) => setInitialValue(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </>
        )}
      </Box>
    </Screen>
  );
};

export default AccountFormScreen;

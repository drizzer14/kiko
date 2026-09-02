import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import TextField from '../../design-system/components/text-field';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';
import ChipRow from './chip-row';
import IconEditor from '../icon-editor';

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

const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

// Neutral placeholder glyph shown in the create form's icon chip until the user
// picks one. The persisted default (a kind-derived icon) is applied by the
// account list rows when the stored icon is null; here the account has no kind
// context worth deriving from yet, so a neutral swatch reads as "unset".
const FALLBACK_ICON = 'square.grid.2x2';

const AccountFormScreen: FC<AccountFormScreenProps> = ({ navigation }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('bank');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');
  const [icon, setIcon] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSave = trimmedName !== '';

  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; the button is also
    // disabled below so this guards the programmatic path too.
    if (!canSave) {
      return;
    }

    if (kind === 'cash') {
      // Clamp a negative initial value to zero — a cash balance can never be
      // negative, and Number('') || 0 also covers a blank field.
      const initialMajor = Math.max(0, Number(initialValue) || 0);
      await accountsRepo.createCashAccount({
        name: trimmedName,
        currency,
        initialBalanceMinorUnits: Money.fromMajor(currency, initialMajor).minorUnits,
      });
      navigation.goBack();

      return;
    }

    const newAccountId = await accountsRepo.create({ name: trimmedName, kind });

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
        {/* A cash account is created atomically via createCashAccount, which
            does not return the new id, so its icon cannot be persisted at create
            time — the icon picker is offered only on the create() path (bank /
            crypto), whose returned id setIcon needs. A cash account's icon can
            still be set later from the accounts list. */}
        {kind !== 'cash' && (
          <IconEditor
            label="Icon"
            icon={icon}
            fallbackIcon={FALLBACK_ICON}
            onSelect={setIcon}
            onRemove={() => setIcon(null)}
          />
        )}

        <TextField label="Name" value={name} onChangeText={setName} placeholder="Name" />

        <ChipRow
          label="Kind"
          options={kinds}
          selected={kind}
          onSelect={setKind}
          labels={KIND_LABELS}
        />

        {kind === 'cash' && (
          <>
            <ChipRow
              label="Currency"
              options={currencies}
              selected={currency}
              onSelect={setCurrency}
            />

            <TextField
              label="Initial value"
              value={initialValue}
              onChangeText={setInitialValue}
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

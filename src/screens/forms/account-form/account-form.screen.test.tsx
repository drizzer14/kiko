import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
  paramsAfter,
} from '@kiko/test-support/navigation-props';
import { darkTheme } from '@kiko/design-system/theme';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';
import { spyOnModalAnimationPerTest } from '@kiko/test-support/modal-animation-spy';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { accountKindSymbol, genericEntitySymbol } from '@kiko/holdings/entity-symbols';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);

const { entityColors } = darkTheme.colors;

const HEX = /^#[0-9a-f]{6}$/i;

// Finds which theme entity-color swatch (if any) the ColorPicker currently
// marks selected, by its accessibility label, and resolves it back to a hex.
// `undefined` means no swatch matches the form's current effective color —
// the failure mode a stored '' or an unmapped kind/type would produce.
const selectedSwatchHex = (
  getByLabelText: Awaited<ReturnType<typeof render>>['getByLabelText'],
): string | undefined => {
  for (const [name, hex] of Object.entries(entityColors)) {
    if (getByLabelText(`Color ${name}`).props.accessibilityState.selected) {
      return hex;
    }
  }

  return undefined;
};

// Opens the AccountKindField sheet and picks the given kind — every kind
// switch goes through this trigger-press -> option-press pair, matching
// the field's own sheet-based interaction.
const selectKind = async (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
  kind: 'bank' | 'cash' | 'crypto' | 'property' | 'metals' | 'debt' | 'broker',
): Promise<void> => {
  await fireEvent.press(getByTestId('account-kind-field'));
  const sheet = getByTestId('account-kind-field-sheet-modal');
  await fireEvent.press(getByTestId(`account-kind-field-option-${kind}`));
  // The sheet's close animation ending, which is when a swap may navigate.
  await act(async () => sheet.props.onDismiss());
};

// A new bank account cannot Save until a bank is picked; tests about anything
// else on the bank form pick the catalog's fallback, "Other bank".
const pickOtherBank = async (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
): Promise<void> => {
  await fireEvent.press(getByTestId('account-bank-type-field'));
  await fireEvent.press(getByTestId('bank-type-option-other'));
};

// The AccountKindField trigger's own `disabled` accessibility state — the
// field carries it directly on its testID'd Pressable, which the read-only-kind
// assertions read.
const isKindFieldDisabled = (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
): boolean => Boolean(getByTestId('account-kind-field').props.accessibilityState.disabled);

const mockCreate = jest.fn();
const mockSaveFormAccount = jest.fn();
const mockCreateCashAccount = jest.fn();
const mockCreateImplicitHolding = jest.fn();
const mockSetIcon = jest.fn();
const mockUpdate = jest.fn();
const mockSaveToken = jest.fn();
const mockSaveCredentials = jest.fn();
const mockClearCredentialsIfWrittenBy = jest.fn();
const mockMonobankSync = jest.fn();
const mockCryptoSync = jest.fn();
const mockFetchAccount = jest.fn();

// The account the edit-mode form loads through useLiveQuery. `mock`-prefixed so
// the hoisted factory may close over it; create-mode tests leave it empty.
let mockAccounts: unknown[] = [];

// A write that was queued before the test began, held until it settles: the mocked repo's `exists`
// waits for it as well. Reset to settled before each test.
let mockQueueEnds: Promise<void> = Promise.resolve();

// Every write the mocked repo has been handed, in call order. The write queue is first in, first
// out: an `exists` answers after the writes registered BEFORE its own call and never waits for one
// registered after it.
let mockWrites: Promise<unknown>[] = [];

const mockRegisterWrite = (write: unknown): unknown => {
  mockWrites.push(Promise.resolve(write).catch(() => undefined));

  return write;
};

// The ids the form asked `exists` about, and an answer that replaces the one read from
// `mockAccounts`: the live query mock shows `mockAccounts` too, so a test that must tell the
// queue's answer from the live query's sets this one.
let mockExistsCalls: string[] = [];
let mockExistsAnswer: boolean | undefined;

beforeEach(() => {
  mockQueueEnds = Promise.resolve();
  mockWrites = [];
  mockUsesRealMonobankField = false;
  mockExistsCalls = [];
  mockExistsAnswer = undefined;
  mockBinanceStoredWhileUnmounted = undefined;
  mockFieldPair = defaultFieldPair;
  mockKeychain = undefined;
});

// The Connect closure the Monobank field was last given: a test calls an unmounted form's own
// closure to run a Connect that is still in flight when the form is folded.
let mockMonobankConnect: ((token: string) => Promise<boolean>) | undefined;

type BinancePair = { apiKey: string; secret: string };

const defaultFieldPair: BinancePair = { apiKey: 'field-key', secret: 'field-secret' };

// The pair the mocked Binance field stores when it connects.
let mockFieldPair: BinancePair = defaultFieldPair;

// What the Binance field was last given to run when it unmounted during the Keychain write that
// stored its pair: a test calls it with the token of that write after the field is gone.
let mockBinanceStoredWhileUnmounted: ((stored: symbol) => Promise<void>) | undefined;

// The Keychain item of the account being created, as the real credentials module keeps it: the
// pair and the token of the one write that stored it. For the tests that tell which write a clear
// removes.
let mockKeychain: { pair: BinancePair; token: symbol } | undefined;

// A write of the item. Every write gets its own token, even for an equal pair.
const mockWriteKeychain = (pair: BinancePair): symbol => {
  const token = Symbol('write');

  mockKeychain = { pair, token };

  return token;
};

// Renders the real Monobank field, whose token check is `mockFetchClientInfo`, in place of the
// mocked one below. Off before each test.
let mockUsesRealMonobankField = false;
const mockFetchClientInfo = jest.fn();

jest.mock('@kiko/monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockAccounts }),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    // Handed to the (mocked) live query as a query object.
    byIdQuery: (accountId: string) =>
      Object.assign(
        Promise.resolve(mockAccounts.filter((row) => (row as { id: string }).id === accountId)),
        { toSQL: () => ({ sql: '', params: [] }) },
      ),
    // Asks the database whether a row exists through the write queue, so it waits behind the
    // writes queued before this call and no others.
    exists: async (accountId: string) => {
      mockExistsCalls.push(accountId);
      const queuedBefore = [...mockWrites];
      await mockQueueEnds;
      await Promise.all(queuedBefore);

      return (
        mockExistsAnswer ?? mockAccounts.some((row) => (row as { id: string }).id === accountId)
      );
    },
    // A Connect's insert of the account row (`mockCreate` records it): the form never reads first.
    createIfAbsent: (...args: unknown[]) => mockRegisterWrite(mockCreate(...args)),
    // The Save of a create form (`mockSaveFormAccount` records it): one write that finds the row
    // itself, so the form never reads it first either.
    saveFormAccount: (...args: unknown[]) => mockRegisterWrite(mockSaveFormAccount(...args)),
    createCashAccount: (...args: unknown[]) => mockRegisterWrite(mockCreateCashAccount(...args)),
    createImplicitHolding: (...args: unknown[]) =>
      mockRegisterWrite(mockCreateImplicitHolding(...args)),
    setIcon: (...args: unknown[]) => mockRegisterWrite(mockSetIcon(...args)),
    update: (...args: unknown[]) => mockRegisterWrite(mockUpdate(...args)),
  },
}));
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
  clearCredentialsIfWrittenBy: (...args: unknown[]) => mockClearCredentialsIfWrittenBy(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockMonobankSync(...args),
  }),
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockCryptoSync(...args),
  }),
}));
// The crypto create form now reuses the shared Wallet|Binance sync form
// (CryptoSyncForm). Its two leaf fields own their own inputs, validation, and
// Keychain writes (covered by their own tests); here each collapses to one
// pressable that fires the screen's `onConnect*` closure, so what is under test
// is the create screen's wiring (create-first, no duplicate, secret stays in the
// field).
// Each mock also honors the `reminder` contract the real fields implement: it
// reports every edit of its input (and its unmount), reports a Connect press,
// hangs the ref on its Connect row and prints the message under it.
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
  const { useEffect } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  return {
    __esModule: true,
    default: ({
      onConnect,
      reminder,
    }: {
      onConnect: (address: string) => Promise<boolean>;
      reminder?: ConnectReminder;
    }) => {
      const onDraftChange = reminder?.onDraftChange;
      useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

      return (
        <View ref={reminder?.ref}>
          <TextInput
            testID="wallet-input"
            onChangeText={(text: string) => reminder?.onDraftChange(text.trim() !== '')}
          />

          <Pressable
            accessibilityLabel="wallet-field"
            onPress={async () => {
              reminder?.onConnectPress();

              if (await onConnect('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')) {
                reminder?.onDraftChange(false);
              }
            }}
          >
            <Text>wallet field</Text>
          </Pressable>

          {reminder?.message !== undefined && (
            <Text testID="wallet-reminder">{reminder.message}</Text>
          )}
        </View>
      );
    },
  };
});
jest.mock('@kiko/design-system/components/binance-credentials-field', () => {
  const { useEffect } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  return {
    __esModule: true,
    default: ({
      onConnect,
      reminder,
      onStoredWhileUnmounted,
    }: {
      onConnect: (stored: symbol) => Promise<boolean>;
      reminder?: ConnectReminder;
      onStoredWhileUnmounted?: (stored: symbol) => Promise<void>;
    }) => {
      mockBinanceStoredWhileUnmounted = onStoredWhileUnmounted;
      const onDraftChange = reminder?.onDraftChange;
      useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

      return (
        <View ref={reminder?.ref}>
          <TextInput
            testID="binance-input"
            onChangeText={(text: string) => reminder?.onDraftChange(text.trim() !== '')}
          />

          <Pressable
            accessibilityLabel="binance-field"
            onPress={async () => {
              reminder?.onConnectPress();

              if (await onConnect(mockWriteKeychain(mockFieldPair))) {
                reminder?.onDraftChange(false);
              }
            }}
          >
            <Text>binance field</Text>
          </Pressable>

          {reminder?.message !== undefined && (
            <Text testID="binance-reminder">{reminder.message}</Text>
          )}
        </View>
      );
    },
  };
});
// The bank create form now offers the SAME explicit-Connect pattern as crypto,
// through MonobankConnectField. It owns its own token input, live validation, and
// status (covered by its own test); here it renders one pressable that fires the
// screen's `connectMonobank` closure with a token, plus a stateful token TextInput
// (testID `monobank-token-input`) that loses its value on unmount, so what is under test is
// the create screen's wiring (create-first, no duplicate, secret via the closure).
jest.mock('@kiko/design-system/components/monobank-connect-field', () => {
  const { useEffect, useState } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  const RealField = jest.requireActual(
    '@kiko/design-system/components/monobank-connect-field',
  ).default;

  // Unlike the wallet/binance mocks above, this one also surfaces the boolean
  // `connectMonobank` resolves to (via a testID) — proving the screen's
  // create -> saveToken -> sync chain actually propagates the sync outcome
  // back to the caller, rather than a mutant swallowing it (e.g. hard-coding
  // `true` or losing a rejection inside the try/catch).
  const MockField = ({
    onConnect,
    reminder,
  }: {
    onConnect: (token: string) => Promise<boolean>;
    reminder?: ConnectReminder;
  }) => {
    mockMonobankConnect = onConnect;
    const [result, setResult] = useState('');
    // Local state of the real field's token input: a remount loses it.
    const [typedToken, setTypedToken] = useState('');
    const onDraftChange = reminder?.onDraftChange;
    useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

    return (
      <View ref={reminder?.ref}>
        <TextInput
          testID="monobank-token-input"
          value={typedToken}
          onChangeText={(text: string) => {
            setTypedToken(text);
            reminder?.onDraftChange(text.trim() !== '');
          }}
        />

        <Pressable
          accessibilityLabel="monobank-field"
          onPress={async () => {
            reminder?.onConnectPress();
            const connected = await onConnect('tok-123');
            setResult(String(connected));

            if (connected) {
              reminder?.onDraftChange(false);
            }
          }}
        >
          <Text>monobank field</Text>
          <Text testID="monobank-connect-result">{result}</Text>
        </Pressable>

        {reminder?.message !== undefined && (
          <Text testID="monobank-reminder">{reminder.message}</Text>
        )}
      </View>
    );
  };

  // A test about the token check a fold or a switch interrupts needs the real field, whose own
  // unmount guard is what keeps a stale check from connecting.
  return {
    __esModule: true,
    default: (props: ComponentProps<typeof MockField>) =>
      mockUsesRealMonobankField ? <RealField {...props} /> : <MockField {...props} />,
  };
});

// The database is the only record of whether a Connect inserted the pending account: a created
// row joins the rows the mocked repo answers with, and a second insert under one id leaves the
// stored row as it is, as the repo's insert-or-ignore does. Save writes the form's fields onto a
// stored row (`mockAccounts` then holds them) or inserts the row when none is stored. `ends` holds
// an insert back until it settles.
const storeCreatedRows = (ends: Promise<void> = Promise.resolve()): void => {
  mockCreate.mockImplementation(async (input: { id: string }) => {
    await ends;

    if (!mockAccounts.some((row) => (row as { id: string }).id === input.id)) {
      mockAccounts = [...mockAccounts, { id: input.id }];
    }

    return input.id;
  });
  mockSaveFormAccount.mockImplementation(async (input: { id: string; name: string }) => {
    await ends;

    mockAccounts = mockAccounts.some((row) => (row as { id: string }).id === input.id)
      ? mockAccounts.map((row) =>
          (row as { id: string }).id === input.id ? { ...(row as object), name: input.name } : row,
        )
      : [...mockAccounts, { id: input.id, name: input.name }];

    return input.id;
  });
};

type RouteParams = AccountFormProps['route']['params'];

const renderForm = async (
  params: RouteParams = {},
): Promise<Awaited<ReturnType<typeof render>> & { navigation: NavigationSpy }> => {
  const navigation = navigationSpy();
  const route = asRouteProp<AccountFormProps['route']>('AccountForm', params);
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigation)}
      route={route}
    />,
  );

  return { ...view, navigation };
};

describe('AccountFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No account loaded by default: create mode. Edit-mode tests seed this.
    mockAccounts = [];
    // create resolves to the new row's id so the form can set its icon on it.
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveFormAccount.mockResolvedValue('new-account-id');
    mockCreateImplicitHolding.mockResolvedValue({
      accountId: 'implicit-account-id',
      holdingId: 'new-holding-id',
    });
    mockSetIcon.mockResolvedValue(undefined);
    // The credential writes resolve so the save flow can await them, and the
    // sync hooks resolve a boolean like the real fire-and-forget connect.
    mockSaveToken.mockResolvedValue(undefined);
    mockSaveCredentials.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
    mockCryptoSync.mockResolvedValue(true);
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderForm();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add account" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add account')).toBeNull();
  });

  // The currency sheet's search field lives inside a Modal above this
  // Screen's background ScrollView, which otherwise misfires
  // `automaticallyAdjustKeyboardInsets` for a responder it does not contain.
  // `CurrencyField`'s `onOpenChange` must gate that prop off for exactly the
  // window the sheet is open.
  it('suspends automaticallyAdjustKeyboardInsets on the background ScrollView while the currency sheet is open', async () => {
    const { getByTestId } = await renderForm();

    await selectKind(getByTestId, 'cash');

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(true);

    await fireEvent.press(getByTestId('account-currency-field'));

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(false);
  });

  it('separates the color picker and the synchronization sub-heading with form dividers', async () => {
    // Default create mode is a bank account, so the "Synchronization" sub-heading
    // renders: one divider sits after the color picker and one before that
    // sub-heading.
    const { getAllByTestId } = await renderForm();

    expect(getAllByTestId('form-divider')).toHaveLength(2);
  });

  it('marks only the required Name field with an asterisk on a kind that picks no bank or broker', async () => {
    const { getByText, getAllByText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'metals');

    // Name gates save (canSave = trimmed name), so it shows the marker; Kind and
    // Color are optional (they carry defaults), so no other asterisk renders.
    expect(getByText('Name')).toBeTruthy();
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('marks the Bank type field required on a new bank account, beside Name', async () => {
    const { getAllByText } = await renderForm();

    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('marks the Broker field required on a new broker account, beside Name', async () => {
    const { getAllByText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'broker');

    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('offers the account kinds with humanized labels and subtitles, Broker included', async () => {
    const { getByTestId } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    // Each row's text content is the label immediately followed by its
    // subtitle (no separator node between them), so this checks a leading
    // partial match rather than an exact one.
    expect(getByTestId('account-kind-field-option-bank')).toHaveTextContent('Bank', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-cash')).toHaveTextContent('Cash', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-crypto')).toHaveTextContent('Crypto', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-property')).toHaveTextContent('Property', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-broker')).toHaveTextContent('Broker', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-broker-description')).toHaveTextContent(
      'Bonds and cash at a broker.',
    );
  });

  it('renders the account-kind sheet options in the order Bank, Cash, Crypto, Property, Metals, Debt, Broker', async () => {
    const { getByTestId, getAllByTestId } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    // AccountKindField lays its rows out in the `kinds` array order
    // (accountKindSymbol's own key order), so their testIDs mount in that
    // same top-to-bottom order. The regex excludes each row's own
    // `-description` child testID, which shares the same prefix.
    const order = getAllByTestId(/^account-kind-field-option-[a-z]+$/).map((node) =>
      (node.props.testID as string).replace('account-kind-field-option-', ''),
    );

    expect(order).toEqual(['bank', 'cash', 'crypto', 'property', 'metals', 'debt', 'broker']);
  });

  it('shows a subtitle under every kind option in the sheet', async () => {
    const { getByTestId } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getByTestId('account-kind-field-option-property-description')).toHaveTextContent(
      'Real estate, car, valuables, money you lent.',
    );
  });

  it('creates a crypto account with the crypto kind (no source connected)', async () => {
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Save'));

    // The row is inserted with the screen's pre-generated id (so a field Connect
    // could have keyed a Keychain write to it); no source was connected here.
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto', color: null }),
    );
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  describe('picking an implicit kind swaps in the holding form', () => {
    const kindSheetModal = spyOnModalAnimationPerTest('account-kind-field-sheet-modal');

    it('replaces the screen with the property holding form, carrying the typed name', async () => {
      const { getByLabelText, getByTestId, navigation } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My House');
      await selectKind(getByTestId, 'property');

      // `replace`, not `navigate`: Back from the holding form must leave the
      // flow rather than land on this stale form.
      expect(navigation.replace).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: 'My House', icon: null, color: null },
      });
      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('waits for the kind sheet to finish closing before replacing the screen', async () => {
      const { getByLabelText, getByTestId, navigation } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My House');
      await fireEvent.press(getByTestId('account-kind-field'));
      const sheet = getByTestId('account-kind-field-sheet-modal');
      await fireEvent.press(getByTestId('account-kind-field-option-property'));

      // Replacing now would unmount the screen that owns the sheet mid-close.
      expect(navigation.replace).not.toHaveBeenCalled();

      await act(async () => sheet.props.onDismiss());

      expect(navigation.replace).toHaveBeenCalledTimes(1);
    });

    // The sheet is still closing here, so the kind field is what tells the user
    // the tap landed; left on the old kind the form looks frozen.
    it.each([
      ['property', 'Property'],
      ['debt', 'Debt'],
    ] as const)(
      'shows %s on the kind field at once, before the sheet has finished closing',
      async (kind, label) => {
        const { getByTestId, navigation } = await renderForm();

        await fireEvent.press(getByTestId('account-kind-field'));
        await fireEvent.press(getByTestId(`account-kind-field-option-${kind}`));

        expect(getByTestId('account-kind-field')).toHaveTextContent(label);
        expect(navigation.replace).not.toHaveBeenCalled();
      },
    );

    // The fade is only a wait for a pick that leaves the form (the replace runs
    // once the sheet is gone), so Property and Loan close with none; a pick that
    // stays keeps it.
    it.each([
      ['property', 'none'],
      ['debt', 'none'],
      ['bank', 'fade'],
      ['cash', 'fade'],
      ['crypto', 'fade'],
      ['metals', 'fade'],
      ['broker', 'fade'],
    ] as const)('closes the kind sheet for %s with animation "%s"', async (kind, animation) => {
      const { getByTestId } = await renderForm();

      await fireEvent.press(getByTestId('account-kind-field'));
      await fireEvent.press(getByTestId(`account-kind-field-option-${kind}`));

      expect(kindSheetModal.lastHiddenAnimation()).toBe(animation);
    });

    // The swap removes the kind-specific fields anyway, so they stay put rather
    // than jumping away for the frames before it.
    it('keeps the fields of the kind it was on while the sheet closes', async () => {
      const { getByTestId, queryByTestId } = await renderForm();

      await selectKind(getByTestId, 'broker');
      expect(queryByTestId('account-broker-type-field')).not.toBeNull();

      await fireEvent.press(getByTestId('account-kind-field'));
      await fireEvent.press(getByTestId('account-kind-field-option-property'));

      expect(queryByTestId('account-broker-type-field')).not.toBeNull();
    });

    it('replaces the screen with the loan holding form when Debt is picked', async () => {
      const { getByLabelText, getByTestId, navigation } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Car loan');
      await selectKind(getByTestId, 'debt');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'debt',
        draft: { name: 'Car loan', icon: null, color: null },
      });
    });

    it('carries the icon and color the user picked', async () => {
      const { getByLabelText, getByTestId, navigation } = await renderForm();

      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon giftcard'));
      await fireEvent.press(getByLabelText('Color violet'));
      await selectKind(getByTestId, 'property');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: '', icon: 'giftcard', color: entityColors.violet },
      });
    });

    it('does not carry the kind default icon, only a pick', async () => {
      const { getByTestId, navigation } = await renderForm();

      await selectKind(getByTestId, 'cash');
      await selectKind(getByTestId, 'debt');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'debt',
        draft: { name: '', icon: null, color: null },
      });
    });

    it('drops an icon picked before a kind switch, as the switch resets it to the default', async () => {
      const { getByLabelText, getByTestId, navigation } = await renderForm();

      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon giftcard'));
      await selectKind(getByTestId, 'crypto');
      await selectKind(getByTestId, 'property');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: '', icon: null, color: null },
      });
    });

    it('does not carry a cleared icon', async () => {
      const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon giftcard'));
      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByText('Remove'));
      await selectKind(getByTestId, 'property');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: '', icon: null, color: null },
      });
    });

    it('creates nothing and does not leave the screen by itself', async () => {
      const { getByTestId, navigation } = await renderForm();

      await selectKind(getByTestId, 'property');

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockCreateImplicitHolding).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('does not swap for a kind that creates an account', async () => {
      const { getByTestId, navigation } = await renderForm();

      await selectKind(getByTestId, 'metals');

      expect(navigation.replace).not.toHaveBeenCalled();
    });
  });

  describe('seeding from a swap back', () => {
    it('opens on the initial kind, with the draft name, icon and color', async () => {
      const { getByLabelText, getByTestId } = await renderForm({
        initialKind: 'cash',
        draft: { name: 'Wallet', icon: 'giftcard', color: entityColors.violet },
      });

      expect(getByTestId('account-kind-field')).toHaveTextContent('Cash');
      expect(getByLabelText('Name').props.value).toBe('Wallet');
      expect(getByLabelText('Icon giftcard')).toBeTruthy();
      expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
    });

    it("shows the initial kind's default icon and color when the draft carries none", async () => {
      const { getByLabelText } = await renderForm({
        initialKind: 'crypto',
        draft: { name: 'Wallet', icon: null, color: null },
      });

      expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();
      expect(selectedSwatchHex(getByLabelText)).toBe(entityColors.yellow);
    });

    it('treats a carried icon as the user pick, so a swap forward again keeps it', async () => {
      const { getByTestId, navigation } = await renderForm({
        initialKind: 'cash',
        draft: { name: '', icon: 'giftcard', color: null },
      });

      await selectKind(getByTestId, 'property');

      expect(navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: '', icon: 'giftcard', color: null },
      });
    });

    it('seeds the kind default icon, not a carried pick, once the kind changes again', async () => {
      const { getByLabelText, getByTestId } = await renderForm({
        initialKind: 'cash',
        draft: { name: '', icon: 'giftcard', color: null },
      });

      await selectKind(getByTestId, 'crypto');

      expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();
    });

    it('still opens a plain create form on bank when no initial kind is given', async () => {
      const { getByLabelText, getByTestId } = await renderForm({});

      expect(getByTestId('account-kind-field')).toHaveTextContent('Bank');
      expect(getByLabelText('Name').props.value).toBe('');
    });
  });

  it('creates a metals account with the metals kind (no bank/crypto section rendered)', async () => {
    // Metals has no extra creation fields yet, so it shares the generic
    // create path with bank/crypto: the row
    // inserts with just name/kind/color/icon, and neither the cash currency
    // fields nor the bank/crypto sync sections render for it.
    const { getByLabelText, getByTestId, getByText, navigation, queryByText, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Gold');
    await selectKind(getByTestId, 'metals');

    expect(queryByTestId('account-currency-field')).toBeNull();
    expect(queryByText('Synchronization')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Gold', kind: 'metals', color: null }),
    );
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a broker account with the picked broker as its bankId, and no sync connection', async () => {
    const { getByLabelText, getByTestId, getByText, navigation, queryByText, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Trading 212');
    await selectKind(getByTestId, 'broker');

    expect(queryByTestId('account-bank-type-field')).toBeNull();
    expect(queryByText('Synchronization')).toBeNull();

    await fireEvent.press(getByTestId('account-broker-type-field'));
    await fireEvent.press(getByTestId('account-broker-type-field-option-trading212'));
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Trading 212', kind: 'broker', bankId: 'trading212' }),
    );
    expect(
      (mockSaveFormAccount.mock.calls[0][0] as { institution?: unknown }).institution,
    ).toBeUndefined();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not create a broker account with no broker picked, and says why on the field', async () => {
    const { getByLabelText, getByTestId, getByText, navigation, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My broker');
    await selectKind(getByTestId, 'broker');

    expect(queryByTestId('account-broker-type-field-error')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByText('Select a broker.')).toBeTruthy();
    expect(getByTestId('account-broker-type-field-error')).toBeTruthy();
  });

  it('does not create a bank account with no bank picked, and says why on the field', async () => {
    const { getByLabelText, getByTestId, getByText, navigation, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My bank');

    expect(queryByTestId('account-bank-type-field-error')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByText('Select a bank.')).toBeTruthy();
    expect(getByTestId('account-bank-type-field-error')).toBeTruthy();
  });

  it('scrolls to the unpicked bank field, a different target than the name, once the name is filled', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByLabelText, getByText } = await renderForm();

    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, nameFieldRef] = scrollToFieldMock.mock.calls[0];

    await fireEvent.changeText(getByLabelText('Name'), 'My bank');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, bankFieldRef] = scrollToFieldMock.mock.calls[0];

    expect(bankFieldRef).not.toBe(nameFieldRef);
    expect(bankFieldRef.current.props.children.props.testID).toBe('account-bank-type-field');
  });

  it('scrolls to the unpicked broker field once the name is filled', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await selectKind(getByTestId, 'broker');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, nameFieldRef] = scrollToFieldMock.mock.calls[0];

    await fireEvent.changeText(getByLabelText('Name'), 'My broker');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, brokerFieldRef] = scrollToFieldMock.mock.calls[0];

    expect(brokerFieldRef).not.toBe(nameFieldRef);
    expect(brokerFieldRef.current.props.children.props.testID).toBe('account-broker-type-field');
  });

  it('shows the name error and the bank error together on one blocked Save, scrolling once', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByText } = await renderForm();

    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter a name.')).toBeTruthy();
    expect(getByText('Select a bank.')).toBeTruthy();
    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
  });

  it('clears the bank error once a bank is picked, and then creates the account with it', async () => {
    const { getByLabelText, getByTestId, getByText, queryByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My bank');
    await fireEvent.press(getByText('Save'));
    await fireEvent.press(getByTestId('account-bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-other'));

    expect(queryByText('Select a bank.')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My bank', kind: 'bank', bankId: 'other' }),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('never writes a picked broker as the bankId once the kind switches to bank', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Switched');
    await selectKind(getByTestId, 'broker');
    await fireEvent.press(getByTestId('account-broker-type-field'));
    await fireEvent.press(getByTestId('account-broker-type-field-option-ibkr'));
    await selectKind(getByTestId, 'bank');
    await fireEvent.press(getByText('Save'));

    // The broker pick is gone, so the bank pick is still missing: nothing is
    // created under the broker's id.
    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(getByText('Select a bank.')).toBeTruthy();
  });

  it('clears the picked broker when the kind switches away and back', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Round trip');
    await selectKind(getByTestId, 'broker');
    await fireEvent.press(getByTestId('account-broker-type-field'));
    await fireEvent.press(getByTestId('account-broker-type-field-option-ibkr'));
    await selectKind(getByTestId, 'cash');
    await selectKind(getByTestId, 'broker');

    expect(getByTestId('account-broker-type-field')).toHaveTextContent('Select a broker', {
      exact: false,
    });

    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(getByText('Select a broker.')).toBeTruthy();
  });

  it('creates one cash account for a double-tapped Save', async () => {
    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so.
    let resolveWrite: () => void = () => {};
    mockCreateCashAccount.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '100');

    const save = getByText('Save');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this file's beforeEach) clears call history but
    // not a custom mockImplementation — reset it explicitly so it does not
    // leak this test's never-auto-resolving write into the next test.
    mockCreateCashAccount.mockReset();
  });

  it('creates a bank account without touching the cash-account path', async () => {
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await selectKind(getByTestId, 'bank');
    await fireEvent.press(getByTestId('account-bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-other'));
    await fireEvent.press(getByText('Save'));

    // The bank row now shares the crypto create path: it is inserted with the
    // screen's pre-generated id (so a field Connect could have keyed a Keychain
    // write to it), not a repo-assigned one.
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null }),
    );
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('keeps the icon field visible after selecting the Cash kind', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    // Choosing Cash must not hide the icon picker — every kind, cash included,
    // can pick an icon in the create form now.
    await selectKind(getByTestId, 'cash');

    expect(getByLabelText('Change Icon')).toBeTruthy();
  });

  it('persists a picked icon on a cash account created atomically', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '100');
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon banknote'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', icon: 'banknote' }),
    );
  });

  it('creates the new account with the picked icon in the one insert', async () => {
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await pickOtherBank(getByTestId);
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon banknote'));
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null, icon: 'banknote' }),
    );
    expect(mockSetIcon).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('opens the create form on the initial kind default icon (bank)', async () => {
    // A fresh create form starts on the bank kind, so its icon field must show
    // the bank default glyph rather than the neutral fallback.
    const { getByLabelText } = await renderForm();

    expect(getByLabelText(`Icon ${accountKindSymbol.bank}`)).toBeTruthy();
  });

  it('sets the icon to each account type default when its kind is selected', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'cash');
    expect(getByLabelText(`Icon ${accountKindSymbol.cash}`)).toBeTruthy();

    await selectKind(getByTestId, 'crypto');
    expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();

    await selectKind(getByTestId, 'metals');
    expect(getByLabelText(`Icon ${accountKindSymbol.metals}`)).toBeTruthy();

    await selectKind(getByTestId, 'bank');
    expect(getByLabelText(`Icon ${accountKindSymbol.bank}`)).toBeTruthy();
  });

  it('resets a hand-picked icon back to the new type default when the type changes', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    // The user overrides the default with a custom icon (from the Kiko Entities
    // pool the account form now offers)...
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon giftcard'));
    expect(getByLabelText('Icon giftcard')).toBeTruthy();

    // ...then switches type, which re-seeds the icon to the new type's default.
    await selectKind(getByTestId, 'crypto');
    expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();
  });

  it('persists the initial kind default icon when the user does not change it', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await pickOtherBank(getByTestId);
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Bank',
        kind: 'bank',
        color: null,
        icon: accountKindSymbol.bank,
      }),
    );
    expect(mockSetIcon).not.toHaveBeenCalled();
  });

  it('falls the account icon field back to the generic tray glyph once the icon is removed', async () => {
    // Clearing the icon (Change Icon -> Remove) drops the field to its generic
    // fallback. The icon rework decided that generic account glyph is `tray`
    // (genericEntitySymbol.account), never the retired `square.grid.2x2` — the
    // "never keep the old icon" rule.
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));

    expect(getByLabelText(`Icon ${genericEntitySymbol.account}`)).toBeTruthy();
  });

  it('creates the account with a null icon when the user removes the default before saving', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await pickOtherBank(getByTestId);
    // Removing clears the seeded default back to null, so the row follows its
    // kind default at display time.
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null, icon: null }),
    );
    expect(mockSetIcon).not.toHaveBeenCalled();
  });

  it('does not create an account when the name is empty (or whitespace only)', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the name-required error directly on the name field, not as a separate block, on a blocked Save press', async () => {
    const { getByText, queryByTestId, getByTestId } = await renderForm();

    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter a name.')).toBeTruthy();
    // The old standalone block is gone — the message now lives on the field.
    expect(queryByTestId('account-name-error')).toBeNull();
    expect(getByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('scrolls to the name field when Save is pressed while it is empty', async () => {
    const { getByText } = await renderForm();

    await fireEvent.press(getByText('Save'));

    expect(scrollToField).toHaveBeenCalled();
  });

  it('shows both the name-required and initial-value-required errors on one blocked Save press when both are blank', async () => {
    const { getByTestId, getByText } = await renderForm();

    await selectKind(getByTestId, 'cash');
    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter a name.')).toBeTruthy();
    expect(getByText('Enter an initial value.')).toBeTruthy();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
  });

  it('scrolls to a DIFFERENT field target once the name is fixed but the initial value is still blank', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByTestId, getByLabelText, getByText } = await renderForm();

    await selectKind(getByTestId, 'cash');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, nameFieldRef] = scrollToFieldMock.mock.calls[0];

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));
    const [, initialValueFieldRef] = scrollToFieldMock.mock.calls[0];

    expect(initialValueFieldRef).not.toBe(nameFieldRef);
  });

  it('shows an initial-value-required error and saves nothing when the field is blank', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter an initial value.')).toBeTruthy();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
  });

  it('shows an initial-value-negative error and saves nothing for a negative value', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '-50');
    await fireEvent.press(getByText('Save'));

    expect(getByText('Initial value must be 0 or greater.')).toBeTruthy();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
  });

  it('saves a typed zero initial value', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '0');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', initialBalance: Money.of('UAH', 0) }),
    );
  });

  it('creates a cash account atomically with the initial value', async () => {
    const { getByLabelText, getByPlaceholderText, getByText, getByTestId, navigation } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByTestId('account-currency-field'));
    // Narrow by search: unfiltered, EUR sorts alphabetically by its localized
    // name ("Euro") outside the FlatList's virtualized initial window
    // (`initialNumToRender={15}`).
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'EUR');
    await fireEvent.press(getByTestId('currency-option-EUR'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith({
      name: 'Wallet',
      currency: 'EUR',
      // Selecting the Cash kind seeds the icon field with the cash default,
      // which the atomic create persists (the user did not override it).
      icon: accountKindSymbol.cash,
      // No color was picked either, so the create passes an explicit null and the
      // row follows its cash kind default at display time.
      color: null,
      initialBalance: Money.of('EUR', 25050),
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('offers only fiat currencies for a cash account (no BTC)', async () => {
    const { getByLabelText, getByPlaceholderText, getByTestId, queryByTestId } = await renderForm();
    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.press(getByTestId('account-currency-field'));
    // Narrow by search: unfiltered, USD ("US Dollar") and GBP ("British Pound
    // Sterling") both sort alphabetically by localized name outside the
    // FlatList's virtualized initial window (`initialNumToRender={15}`), and
    // no single query matches both, so search for each in turn.
    const search = getByPlaceholderText('Search by code or name');

    await fireEvent.changeText(search, 'USD');
    expect(getByTestId('currency-option-USD')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();

    await fireEvent.changeText(search, 'GBP');
    expect(getByTestId('currency-option-GBP')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();
  });

  it('surfaces an alert and does not navigate when the cash create fails', async () => {
    mockCreateCashAccount.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '100');
    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('AccountFormScreen color follows kind until dirty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveFormAccount.mockResolvedValue('new-account-id');
  });

  it("selects the default kind's color before any pick (bank -> white)", async () => {
    const { getByLabelText } = await renderForm();

    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(true);
  });

  it('re-derives the color to the newly selected kind default while not dirty', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    // bank default is white; switching to crypto swaps the selected default
    // swatch to yellow, because the color has not been manually picked.
    await selectKind(getByTestId, 'crypto');

    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
  });

  it('keeps a manually picked color when the kind changes afterwards (dirty)', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    await fireEvent.press(getByLabelText('Color violet'));

    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    await selectKind(getByTestId, 'crypto');

    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(false);
  });

  it('persists the manually picked color on a bank account', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await pickOtherBank(getByTestId);
    await fireEvent.press(getByLabelText('Color violet'));
    await fireEvent.press(getByText('Save'));

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Bank',
        kind: 'bank',
        color: entityColors.violet,
      }),
    );
  });

  it('persists the manually picked color on a cash account', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '100');
    await fireEvent.press(getByLabelText('Color violet'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', color: entityColors.violet }),
    );
  });
});

describe('AccountFormScreen edit mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Ukrsibbank Card',
        kind: 'bank',
        icon: 'banknote',
        color: entityColors.violet,
        bankId: null,
      },
    ];
  });

  it('sets the header title to "Edit Account"', async () => {
    const { navigation } = await renderForm({ accountId: 'acc-1' });

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Account' });
  });

  it('seeds the name field from the existing account', async () => {
    const { getByDisplayValue } = await renderForm({ accountId: 'acc-1' });

    expect(getByDisplayValue('Ukrsibbank Card')).toBeTruthy();
  });

  it('seeds the stored icon and color as the selected swatch', async () => {
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(getByLabelText('Icon banknote')).toBeTruthy();
    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
  });

  it('shows the kind read-only (disabled) so it cannot change after creation', async () => {
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    // The kind field still shows Bank selected, but pressing it is inert — the
    // sheet never opens, so no option row mounts.
    expect(getByTestId('account-kind-field')).toHaveTextContent('Bank');
    expect(isKindFieldDisabled(getByTestId)).toBe(true);
    await fireEvent.press(getByTestId('account-kind-field'));
    expect(() => getByTestId('account-kind-field-option-crypto')).toThrow();

    // Save still routes to the account's original kind via update (never create).
    await fireEvent.press(getByText('Save'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not render the cash currency or initial-value fields in edit mode', async () => {
    mockAccounts = [{ id: 'acc-1', name: 'Wallet', kind: 'cash', icon: null, color: null }];
    const { queryByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(queryByLabelText('Initial value')).toBeNull();
  });

  it('saves through the update path with the edited name and color, and sets the icon', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed account');
    await fireEvent.press(getByLabelText('Color teal'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', {
      name: 'Renamed account',
      color: entityColors.teal,
    });
    expect(mockSetIcon).toHaveBeenCalledWith('acc-1', 'banknote');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not save an empty (whitespace-only) edited name', async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('resolves a stored empty-string color to a real swatch, not blank', async () => {
    mockAccounts = [{ id: 'acc-1', name: 'X', kind: 'cash', icon: null, color: '' }];
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
  });

  it('resolves a since-removed account kind to a real swatch, not blank', async () => {
    // The schema enum is TS-only with no CHECK constraint, so a row under a
    // kind outside the current list can still exist.
    mockAccounts = [{ id: 'acc-1', name: 'X', kind: 'retired_kind', icon: null, color: null }];
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
  });

  it('edit-hydrates bankId from the stored row and shows it pre-selected in the bank picker', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('PrivatBank');
  });

  it('edit-hydrates a broker account and re-selects its broker in the broker picker', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'T212', kind: 'broker', icon: null, color: null, bankId: 'trading212' },
    ];
    const { getByTestId, getByText, queryByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-kind-field')).toHaveTextContent('Broker');
    expect(getByTestId('account-broker-type-field')).toHaveTextContent('Trading 212', {
      exact: false,
    });
    expect(queryByTestId('account-bank-type-field')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect('bankId' in (mockUpdate.mock.calls[0][1] as Record<string, unknown>)).toBe(false);
  });

  // The kind, bank and broker are set once, on create: each shows its stored
  // value, but disabled and inert, and Save never writes any of them.
  it('shows the broker read-only (disabled) in edit mode, and pressing it opens no sheet', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'T212', kind: 'broker', icon: null, color: null, bankId: 'trading212' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-broker-type-field').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(getByTestId('account-broker-type-field'));

    expect(() => getByTestId('account-broker-type-field-option-other')).toThrow();
  });

  it('shows the bank read-only (disabled) in edit mode, and pressing it opens no sheet', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('PrivatBank');
    expect(getByTestId('account-bank-type-field').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(getByTestId('account-bank-type-field'));

    expect(() => getByTestId('bank-type-option-other')).toThrow();
  });

  it.each([
    ['a bank named in the catalog', 'bank', 'privatbank'],
    ['a bank stored as no bank', 'bank', null],
    ['a since-removed catalog id', 'bank', 'removedbank'],
    ['a broker', 'broker', 'trading212'],
    ['a broker stored as no broker', 'broker', null],
    ['a broker stored with a bank id', 'broker', 'monobank'],
  ])('never writes the bank id on an edit Save: %s', async (_name, kind, bankId) => {
    mockAccounts = [{ id: 'acc-1', name: 'Account', kind, icon: null, color: null, bankId }];
    const { getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', { name: 'Account', color: null });
  });

  it('shows no broker picked for a broker account whose stored bankId is not a catalog broker', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Old', kind: 'broker', icon: null, color: null, bankId: 'monobank' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-broker-type-field')).toHaveTextContent('Select a broker', {
      exact: false,
    });
  });

  it('shows no bank picked for a bank account whose stored bankId is a since-removed catalog id', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'removedbank' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('Select a bank');
  });

  // The "Synchronization" heading renders above the bank picker in edit
  // mode too, not just create — otherwise that block sits under a bare
  // divider with no section name at all.
  it('shows the Synchronization heading above the bank picker in edit mode too', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByText } = await renderForm({ accountId: 'acc-1' });

    expect(getByText('Synchronization')).toBeTruthy();
  });

  it('shows the placeholder for an account saved with no bankId', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('Select a bank');
  });

  it('shows "Other bank" for an account stored as other', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'other' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('Other bank');
  });

  it('shows no required marker and no error on the bank picker in edit mode, even after a Save', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByText, queryByText, queryByTestId, getAllByText } = await renderForm({
      accountId: 'acc-1',
    });

    // Only the Name's own asterisk.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(1);

    await fireEvent.press(getByText('Save'));

    expect(queryByText('Select a bank.')).toBeNull();
    expect(queryByTestId('account-bank-type-field-error')).toBeNull();
  });

  it('saves an existing broker account with no broker picked, without forcing a pick', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Old', kind: 'broker', icon: null, color: null, bankId: null },
    ];
    const { getByText, queryByText, queryByTestId, getAllByText } = await renderForm({
      accountId: 'acc-1',
    });

    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(1);

    await fireEvent.press(getByText('Save'));

    expect(queryByText('Select a broker.')).toBeNull();
    expect(queryByTestId('account-broker-type-field-error')).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows a connected Monobank account’s bank read-only and saves without the bank id or the connection', async () => {
    // Every account's bank is set on create only, so a connected one needs no
    // special case: the field is disabled and the update patch carries neither
    // `bankId` nor `institution`, so the live connection can never be touched
    // from here.
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Monobank Card',
        kind: 'bank',
        icon: null,
        color: null,
        bankId: 'monobank',
        institution: 'monobank',
      },
    ];
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('Monobank');
    expect(getByTestId('account-bank-type-field').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', { name: 'Monobank Card', color: null });
  });
});

describe('AccountFormScreen edit mode — implicit Properties / Loans account', () => {
  const implicitAccount = (overrides: Record<string, unknown> = {}) => ({
    id: 'implicit-1',
    name: 'Properties',
    kind: 'property',
    icon: null,
    color: null,
    bankId: null,
    archivedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [implicitAccount()];
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('opens a Properties account holding the sentinel with the localized default name', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByDisplayValue } = await renderForm({ accountId: 'implicit-1' });

    expect(getByDisplayValue('Майно')).toBeTruthy();
  });

  it('opens a Loans account holding the sentinel with the localized default name', async () => {
    mockAccounts = [implicitAccount({ id: 'implicit-2', name: 'Loans', kind: 'debt' })];
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByDisplayValue } = await renderForm({ accountId: 'implicit-2' });

    expect(getByDisplayValue('Кредити')).toBeTruthy();
  });

  it('opens a renamed account with the name as typed, in any language', async () => {
    mockAccounts = [implicitAccount({ name: 'Family assets' })];
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByDisplayValue } = await renderForm({ accountId: 'implicit-1' });

    expect(getByDisplayValue('Family assets')).toBeTruthy();
  });

  it('saves the sentinel when the localized default is left unchanged', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText, navigation } = await renderForm({ accountId: 'implicit-1' });

    await fireEvent.press(getByText('Зберегти'));

    expect(mockUpdate).toHaveBeenCalledWith('implicit-1', {
      name: 'Properties',
      color: null,
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('saves the sentinel of a Loans account left unchanged in English', async () => {
    mockAccounts = [implicitAccount({ id: 'implicit-2', name: 'Loans', kind: 'debt' })];

    const { getByText } = await renderForm({ accountId: 'implicit-2' });

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('implicit-2', {
      name: 'Loans',
      color: null,
    });
  });

  it('saves a renamed account under the name typed, and the picked color', async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'implicit-1' });

    await fireEvent.changeText(getByLabelText('Name'), '  Family assets ');
    await fireEvent.press(getByLabelText('Color teal'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('implicit-1', {
      name: 'Family assets',
      color: entityColors.teal,
    });
  });

  it("saves the OTHER kind's sentinel typed as a name as the name typed", async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'implicit-1' });

    await fireEvent.changeText(getByLabelText('Name'), 'Loans');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('implicit-1', {
      name: 'Loans',
      color: null,
    });
  });

  it('does not save a blank name', async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'implicit-1' });

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("shows the kind's default glyph while the stored icon is NULL, and keeps it NULL on Save", async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'implicit-1' });

    expect(getByLabelText(`Icon ${accountKindSymbol.property}`)).toBeTruthy();

    await fireEvent.press(getByText('Save'));

    expect(mockSetIcon).toHaveBeenCalledWith('implicit-1', null);
  });

  it("shows a Loans account's default glyph while the stored icon is NULL", async () => {
    mockAccounts = [implicitAccount({ id: 'implicit-2', name: 'Loans', kind: 'debt' })];
    const { getByLabelText } = await renderForm({ accountId: 'implicit-2' });

    expect(getByLabelText(`Icon ${accountKindSymbol.debt}`)).toBeTruthy();
  });

  it('shows the stored icon over the default', async () => {
    mockAccounts = [implicitAccount({ icon: 'star.fill' })];
    const { getByLabelText } = await renderForm({ accountId: 'implicit-1' });

    expect(getByLabelText('Icon star.fill')).toBeTruthy();
  });

  it('keeps the title and the read-only kind field', async () => {
    const { getByTestId, navigation } = await renderForm({ accountId: 'implicit-1' });

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Account' });
    expect(isKindFieldDisabled(getByTestId)).toBe(true);
  });
});

describe('AccountFormScreen — the icon picker offers the default glyph of every account kind', () => {
  const defaults: readonly string[] = Object.values(accountKindSymbol);

  const offeredIcons = (
    getAllByLabelText: Awaited<ReturnType<typeof render>>['getAllByLabelText'],
  ) =>
    getAllByLabelText(/^Choose icon /).map((option) =>
      String(option.props.accessibilityLabel).replace('Choose icon ', ''),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockSetIcon.mockResolvedValue(undefined);
  });

  it.each(Object.entries(accountKindSymbol))(
    'lets a %s account that stores a custom icon pick its default %s back',
    async (kind, defaultIcon) => {
      mockAccounts = [
        {
          id: 'acc-1',
          name: 'Account',
          kind,
          icon: 'giftcard',
          color: null,
          bankId: null,
          archivedAt: null,
        },
      ];
      const { getAllByLabelText, getByLabelText, getByText } = await renderForm({
        accountId: 'acc-1',
      });

      await fireEvent.press(getByLabelText('Change Icon'));

      const offered = offeredIcons(getAllByLabelText);

      expect(offered.slice(0, defaults.length)).toEqual(defaults);
      expect(new Set(offered).size).toBe(offered.length);

      await fireEvent.press(getByLabelText(`Choose icon ${defaultIcon}`));
      await fireEvent.press(getByText('Save'));

      expect(mockSetIcon).toHaveBeenCalledWith('acc-1', defaultIcon);
    },
  );

  it('offers a new account the defaults first once it holds a custom icon', async () => {
    const { getAllByLabelText, getByLabelText } = await renderForm();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon giftcard'));
    await fireEvent.press(getByLabelText('Change Icon'));

    expect(offeredIcons(getAllByLabelText).slice(0, defaults.length)).toEqual(defaults);
  });
});

describe('AccountFormScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the kind/color/currency field chrome from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByTestId, getByText, queryByText } = await renderForm();

    expect(getByLabelText('Назва')).toBeTruthy();
    expect(getByText('Колір')).toBeTruthy();
    expect(getByText('Вид')).toBeTruthy();
    // The trigger shows the default (bank) kind's translated label without
    // opening the sheet.
    expect(getByTestId('account-kind-field')).toHaveTextContent('Банк');

    await fireEvent.press(getByTestId('account-kind-field'));
    expect(getByTestId('account-kind-field-option-cash')).toHaveTextContent('Готівка', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-crypto')).toHaveTextContent('Крипто', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-property')).toHaveTextContent('Майно', {
      exact: false,
    });

    expect(getByText('Зберегти')).toBeTruthy();
    expect(queryByText('Bank')).toBeNull();
  });
});

describe('AccountFormScreen — sync credentials on create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveFormAccount.mockResolvedValue('new-account-id');
    mockSetIcon.mockResolvedValue(undefined);
    mockSaveToken.mockResolvedValue(undefined);
    mockSaveCredentials.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
    mockCryptoSync.mockResolvedValue(true);
    // Validation resolves by default (a valid credential); a test that needs an
    // invalid one rejects these explicitly.
    mockFetchAccount.mockResolvedValue({});
  });

  it('connect creates the bank row once, saves the token to the Keychain, and syncs it', async () => {
    // The field's own Connect (mocked to fire with a token) drives the screen's
    // connectMonobank closure: create the row FIRST, store the secret keyed by
    // that pre-generated id, then start the first sync (the write-only-secret
    // order).
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', name: 'My Bank' }),
    );
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockSaveToken).toHaveBeenCalledWith(createdId, 'tok-123');
    expect(mockMonobankSync).toHaveBeenCalledWith(createdId);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    // connectMonobank must resolve to the sync's own outcome, not a hard-coded
    // `true` — proves `return syncMonobank(...)` actually propagates.
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('true'),
    );
  });

  it('resolves connectMonobank to false when the sync itself fails (no thrown error)', async () => {
    // A sync that resolves false (not a rejection) is a distinct outcome from a
    // thrown create/saveToken error below: the token was stored fine, but the
    // sync did not succeed. The result must still propagate as false.
    mockMonobankSync.mockResolvedValue(false);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
    expect(mockSaveToken).toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
  });

  it('does not save a token or sync when the bank row create rejects', async () => {
    // Mirrors the crypto create-reject coverage for the bank-specific
    // connectMonobank closure: a failed create must short-circuit BEFORE
    // saveToken/sync ever run, and connectMonobank must resolve to false (its
    // own try/catch), not throw or resolve true.
    mockCreate.mockRejectedValueOnce(new Error('db locked'));
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    // No row was actually inserted (the started mark was reset), so the kind
    // switch must not lock.
    expect(isKindFieldDisabled(view.getByTestId)).toBe(false);
  });

  it('does not sync when saving the token to the Keychain fails', async () => {
    // Unique to the bank flow (crypto has no saveToken step): the row IS
    // created successfully, but the Keychain write throws. connectMonobank's
    // own try/catch must still resolve false and must never call syncMonobank.
    mockSaveToken.mockRejectedValueOnce(new Error('keychain write failed'));
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockSaveToken).toHaveBeenCalledTimes(1));
    expect(mockMonobankSync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    // Unlike a create failure, the row itself was created before saveToken
    // threw, so the kind switch stays locked — the started mark was never reset.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
  });

  it('resolves connectMonobank to false, not a rejection, when ensureAccount throws synchronously', async () => {
    // Provokes the synchronous throw ensureAccount's name-required branch can
    // raise (here, a scrollToField layout failure) BEFORE it reaches its own
    // `return Promise.reject(...)` — proving `accountEnsured` still resolves
    // false instead of leaving `connectMonobank` a rejected promise.
    (scrollToField as jest.Mock).mockImplementationOnce(() => {
      throw new Error('layout not ready');
    });
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('connect then Save saves onto the same row — never a duplicate account', async () => {
    // Connect-first: the field's Connect already inserted the row. A later Save is the one
    // write that finds that row and stores the name edit on it, never a second account.
    storeCreatedRows();
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1); // still one — Save inserted nothing
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: (mockCreate.mock.calls[0][0] as { id: string }).id,
        name: 'My Bank',
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetIcon).not.toHaveBeenCalled();
  });

  it('inserts the row again on a Connect after it was deleted elsewhere, before the token is stored', async () => {
    storeCreatedRows();
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(1));
    const pendingId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    mockAccounts = [];

    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(2));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ id: pendingId }));
    expect(mockAccounts).toEqual([{ id: pendingId }]);
    expect(mockCreate.mock.invocationCallOrder[1]).toBeLessThan(
      mockSaveToken.mock.invocationCallOrder[1],
    );
  });

  it('Save with no connect creates the bank row and stores no token', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'Plain Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-other'));
    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', name: 'Plain Bank', bankId: 'other' }),
    );
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  // The placeholder, not a pre-selected value: a new bank account must pick.
  it('does not auto-select any bank on a fresh bank create (no auto-jump to Monobank)', async () => {
    const view = await renderForm();

    await selectKind(view.getByTestId, 'bank');

    expect(view.getByText('Select a bank')).toBeTruthy();
    expect(view.queryByLabelText('monobank-field')).toBeNull();
  });

  it('lists all six banks and Other bank in the picker sheet', async () => {
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Bank type'));

    expect(view.getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-alfa')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-other')).toBeTruthy();
  });

  it('shows the import-only hint for a named import-only bank, but not for Other bank (the old "no bank" state)', async () => {
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-privatbank'));

    expect(view.getByText('You can import a statement for this bank after saving.')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-other'));

    expect(view.queryByText('You can import a statement for this bank after saving.')).toBeNull();
  });

  it('creates the bank row tagged with the selected bank id when connecting Monobank', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ bankId: 'monobank' }));
  });

  it('shows no fake connect field for an import-only bank, and creates the row tagged with its bank id on Save', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My PrivatBank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-privatbank'));

    expect(view.queryByLabelText('monobank-field')).toBeNull();
    expect(view.getByText('PrivatBank')).toBeTruthy();

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My PrivatBank', kind: 'bank', bankId: 'privatbank' }),
    );
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  it('connecting a bank source locks the kind switch', async () => {
    // Connecting inserts the bank row; switching to crypto afterwards would leave
    // that bank row behind and make Save write a crypto account onto its id, so
    // the kind field is disabled once connected.
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(isKindFieldDisabled(view.getByTestId)).toBe(true));
  });

  it('connecting Monobank locks the bank picker, and Save still writes the connected bank', async () => {
    // Re-picking the bank after the connect inserted the row would make Save
    // write that pick over the connected Monobank row's bank id.
    storeCreatedRows();
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(isKindFieldDisabled(view.getByTestId)).toBe(true));
    const bankField = view.getByTestId('account-bank-type-field');

    expect(bankField.props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(bankField);

    expect(view.queryByTestId('bank-type-option-other')).toBeNull();
    expect(bankField).toHaveTextContent('Monobank');

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdId, bankId: 'monobank' }),
    );
  });

  it('keeps the bank pick, the custom icon and the typed token when the already-selected Bank kind is picked again', async () => {
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Change Icon'));
    await fireEvent.press(view.getByLabelText('Choose icon giftcard'));
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.changeText(view.getByTestId('monobank-token-input'), 'typed-token');

    await selectKind(view.getByTestId, 'bank');

    expect(view.getByTestId('account-bank-type-field')).toHaveTextContent('Monobank');
    expect(view.getByLabelText('Icon giftcard')).toBeTruthy();
    expect(view.getByTestId('monobank-token-input').props.value).toBe('typed-token');
  });

  it('keeps the broker pick and the custom icon when the already-selected Broker kind is picked again', async () => {
    const view = await renderForm();

    await selectKind(view.getByTestId, 'broker');
    await fireEvent.press(view.getByLabelText('Change Icon'));
    await fireEvent.press(view.getByLabelText('Choose icon giftcard'));
    await fireEvent.press(view.getByTestId('account-broker-type-field'));
    await fireEvent.press(view.getByTestId('account-broker-type-field-option-ibkr'));

    await selectKind(view.getByTestId, 'broker');

    expect(view.getByTestId('account-broker-type-field')).toHaveTextContent('Interactive Brokers');
    expect(view.getByLabelText('Icon giftcard')).toBeTruthy();
  });

  it('shows the name-required reason only after a Connect is attempted with an empty name, on the bank form', async () => {
    const view = await renderForm();

    expect(view.queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    expect(view.queryByTestId('holding-identity-name-field-error')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    expect(view.queryByTestId('holding-identity-name-field-error')).toBeNull();
  });

  it('reuses the shared Wallet|Binance sync form (picker + fields) on the crypto create', async () => {
    // The crypto create form must present the SAME synchronization form as the
    // account-detail screen: a Wallet/Binance source picker and the matching
    // field, proving it reuses CryptoSyncForm rather than hand-rolling a second
    // Binance-only copy. The two secure API-key/secret TextFields are gone.
    const { getByLabelText, getByTestId, getByText, queryByLabelText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');

    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Binance')).toBeTruthy();
    // Wallet is the default source, so its field shows first.
    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('API key')).toBeNull();

    await fireEvent.press(getByText('Binance'));
    expect(getByLabelText('binance-field')).toBeTruthy();
  });

  it('shows the crypto sync form immediately on selecting Crypto, with no name gate', async () => {
    // Full parity with the bank form: the sync form appears the moment Crypto is
    // selected, empty name or not. No account row is created without a name — that
    // is enforced at Connect/Save time, not by hiding the form.
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');

    // The Wallet source field (the default source) is present with no name typed.
    expect(getByLabelText('wallet-field')).toBeTruthy();
  });

  it('shows the name-required reason only after a Connect is attempted with an empty name, on the crypto form', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(getByLabelText('wallet-field'));
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();
  });

  it('does not create a crypto account when a source Connect is tapped with an empty name', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(isKindFieldDisabled(getByTestId)).toBe(false);
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('scrolls the same mounted name field into view with the live scroll geometry on a blocked Connect and a blocked Save', async () => {
    (useHeaderInset as jest.Mock).mockReturnValue(96);
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent(getByTestId('screen-scroll-view'), 'contentSizeChange', 0, 640);
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    const [connectScrollable, connectFieldRef, connectGeometry, connectOnSettled] =
      scrollToFieldMock.mock.calls[0];
    expect(connectScrollable).toEqual({ current: null });
    expect(connectFieldRef.current).not.toBeNull();
    expect(connectGeometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(connectOnSettled).toEqual(expect.any(Function));

    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));

    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    const [, saveFieldRef, saveGeometry, saveOnSettled] = scrollToFieldMock.mock.calls[0];
    expect(saveFieldRef).toBe(connectFieldRef);
    expect(saveGeometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(saveOnSettled).toEqual(expect.any(Function));
  });

  it('scrolls the bank picker, which has no keyboard, without a focus follow-up once the name is filled', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Main');
    scrollToFieldMock.mockClear();
    await fireEvent.press(getByText('Save'));

    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    const [, catalogFieldRef, , onSettled] = scrollToFieldMock.mock.calls[0];
    expect(catalogFieldRef.current).not.toBeNull();
    expect(onSettled).toBeUndefined();
  });

  it('does not create a crypto account when the Binance field Connect is tapped with an empty name', async () => {
    const { getByLabelText, getByTestId, getByText, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(isKindFieldDisabled(getByTestId)).toBe(false);
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  // The Binance field stores the key pair before it calls the screen's connect,
  // so a connect that cannot create the row leaves a pair no account owns.
  describe('the key pair the Binance field stored before the connect', () => {
    it('is cleared when the empty name blocks the account row', async () => {
      mockClearCredentialsIfWrittenBy.mockResolvedValue(undefined);
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1));
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockKeychain).toBeDefined();
      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(
        expect.any(String),
        mockKeychain?.token,
      );
    });

    it('is cleared when the account row cannot be inserted', async () => {
      mockClearCredentialsIfWrittenBy.mockResolvedValue(undefined);
      mockCreate.mockRejectedValueOnce(new Error('db locked'));
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1));
      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(
        (mockCreate.mock.calls[0][0] as { id: string }).id,
        mockKeychain?.token,
      );
      expect(mockCryptoSync).not.toHaveBeenCalled();
    });

    it('stays when the empty name blocks a second Connect while the row exists', async () => {
      storeCreatedRows();
      mockCryptoSync.mockResolvedValue(true);
      const { getByLabelText, getByTestId, getByText, queryByTestId } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));
      await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));

      await fireEvent.changeText(getByLabelText('Name'), '');
      await fireEvent.press(getByLabelText('binance-field'));
      await act(async () => {});

      expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
      expect(mockCryptoSync).toHaveBeenCalledTimes(1);
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
      expect(mockAccounts).toHaveLength(1);
    });

    it('stays when an insert of the row is still queued as the empty name blocks a Connect', async () => {
      let finishInsert = (): void => undefined;
      storeCreatedRows(
        new Promise<void>((resolve) => {
          finishInsert = resolve;
        }),
      );
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      // This Connect's insert waits in the queue, as the one of the screen a fold replaced does.
      let queuedConnect: Promise<unknown> = Promise.resolve();
      await act(async () => {
        queuedConnect = fireEvent.press(getByLabelText('binance-field'));
      });
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      await fireEvent.changeText(getByLabelText('Name'), '');
      let blockedConnect: Promise<unknown> = Promise.resolve();
      await act(async () => {
        blockedConnect = fireEvent.press(getByLabelText('binance-field'));
      });

      await act(async () => {
        finishInsert();
        await queuedConnect;
        await blockedConnect;
      });

      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
      expect(mockAccounts).toHaveLength(1);
    });

    it('stays when the screen a fold replaced inserted the row first, leaving one account', async () => {
      // The insert leaves that row as it is, so the Connect goes on to its sync.
      mockCreate.mockImplementation(async (input: { id: string }) => {
        mockAccounts = [{ id: input.id }];

        return input.id;
      });
      mockCryptoSync.mockResolvedValue(true);
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));
      expect(mockCryptoSync).toHaveBeenCalledWith(
        expect.objectContaining({
          targetAccountId: mockAccounts.map((row) => (row as { id: string }).id)[0],
        }),
      );
      expect(mockAccounts).toHaveLength(1);
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
    });

    it('stays once the row exists, even when the first sync fails', async () => {
      mockCryptoSync.mockResolvedValue(false);
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
    });

    it('stays when an icon write fails after the row exists, since the icon goes in the create', async () => {
      mockSetIcon.mockRejectedValue(new Error('icon write failed'));
      mockCryptoSync.mockResolvedValue(true);
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ icon: accountKindSymbol.crypto }),
      );
      expect(mockSetIcon).not.toHaveBeenCalled();
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
    });

    it('does not fail the connect when the clear itself fails', async () => {
      mockClearCredentialsIfWrittenBy.mockRejectedValueOnce(new Error('keychain delete failed'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

      warn.mockRestore();
    });
  });

  // The field reports a pair it stored after it unmounted: a fold or a kind switch removed it
  // during the Keychain write, so no Connect ever ran for it.
  describe('the key pair the Binance field stored while it unmounted', () => {
    const oldPair: BinancePair = { apiKey: 'old-key', secret: 'old-secret' };
    const oldWrite = Symbol('write of the old pair');

    const storedAfterKindSwitch = async (): Promise<(stored: symbol) => Promise<void>> => {
      const { getByLabelText, getByTestId, getByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      const stored = mockBinanceStoredWhileUnmounted;

      expect(stored).toBeDefined();
      await selectKind(getByTestId, 'bank');

      return stored as (stored: symbol) => Promise<void>;
    };

    it('is cleared when no row owns it', async () => {
      mockClearCredentialsIfWrittenBy.mockResolvedValue(undefined);
      const stored = await storedAfterKindSwitch();

      await act(async () => stored(oldWrite));

      expect(mockExistsCalls).toHaveLength(1);
      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1);
      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(mockExistsCalls[0], oldWrite);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('is cleared after a fold when no row owns it', async () => {
      mockClearCredentialsIfWrittenBy.mockResolvedValue(undefined);
      const { getByLabelText, getByTestId, getByText, unmount } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
      await selectKind(getByTestId, 'crypto');
      await fireEvent.press(getByText('Binance'));
      const stored = mockBinanceStoredWhileUnmounted;
      await emitLayoutMode('columns');
      await unmount();

      expect(stored).toBeDefined();
      await act(async () => stored?.(oldWrite));

      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1);
      expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(mockExistsCalls[0], oldWrite);
    });

    it('stays when a row owns it', async () => {
      mockExistsAnswer = true;
      const stored = await storedAfterKindSwitch();

      await act(async () => stored(oldWrite));

      expect(mockExistsCalls).toHaveLength(1);
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
    });

    it('stays when the read of the row fails', async () => {
      const stored = await storedAfterKindSwitch();
      mockQueueEnds = Promise.reject(new Error('database is locked'));

      await act(async () => stored(oldWrite));

      expect(mockExistsCalls).toHaveLength(1);
      expect(mockClearCredentialsIfWrittenBy).not.toHaveBeenCalled();
    });

    // The Keychain item the clear acts on is tracked here: a clear removes the stored pair only
    // when the token it is given names the write that stored it.
    describe('with the pair in the Keychain', () => {
      beforeEach(() => {
        mockKeychain = { pair: oldPair, token: oldWrite };
        mockClearCredentialsIfWrittenBy.mockImplementation(async (_accountId, token) => {
          if (mockKeychain?.token === token) {
            mockKeychain = undefined;
          }
        });
      });

      afterEach(() => {
        mockClearCredentialsIfWrittenBy.mockReset();
      });

      it('removes the pair that no new Connect replaced', async () => {
        const stored = await storedAfterKindSwitch();

        await act(async () => stored(oldWrite));

        expect(mockKeychain).toBeUndefined();
      });

      // The remounted field saves its own pair before its row insert is queued, so the existence
      // check for the old write can answer "no row" after that pair is already stored.
      const checkOldWriteWhileRemountedFieldSaves = async (): Promise<void> => {
        const { getByLabelText, getByTestId, getByText } = await renderForm();

        await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
        await selectKind(getByTestId, 'crypto');
        await fireEvent.press(getByText('Binance'));
        const stored = mockBinanceStoredWhileUnmounted;
        await selectKind(getByTestId, 'bank');
        let finishQueuedWrite = (): void => undefined;
        mockQueueEnds = new Promise<void>((resolve) => {
          finishQueuedWrite = resolve;
        });
        mockExistsAnswer = false;
        let check: Promise<void> | undefined;
        await act(async () => {
          check = stored?.(oldWrite);
        });

        await selectKind(getByTestId, 'crypto');
        await fireEvent.press(getByText('Binance'));
        await fireEvent.press(getByLabelText('binance-field'));
        await act(async () => {
          finishQueuedWrite();
          await check;
        });
      };

      it('keeps a pair the remounted field saved while the check was queued behind a write', async () => {
        await checkOldWriteWhileRemountedFieldSaves();

        expect(mockKeychain?.pair).toEqual(mockFieldPair);
        expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(mockExistsCalls[0], oldWrite);
      });

      // The user typed the same keys again: the old write must still not clear what the new one
      // stored, so the row keeps its keys.
      it('keeps an equal pair the remounted field saved while the check was queued', async () => {
        mockFieldPair = oldPair;

        await checkOldWriteWhileRemountedFieldSaves();

        expect(mockKeychain?.pair).toEqual(oldPair);
        expect(mockKeychain?.token).not.toBe(oldWrite);
        expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(mockExistsCalls[0], oldWrite);
      });
    });
  });

  it('treats a whitespace-only name exactly like an empty name on the crypto form', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await selectKind(getByTestId, 'crypto');

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('retries the crypto create after an empty-name reject, once a valid name is entered', async () => {
    // The empty-name reject inside ensureAccount must leave no started mark
    // behind: a first Connect with no name creates nothing, and a SECOND
    // Connect on the same field — after typing a valid name — must still succeed,
    // creating the account exactly once and running its sync.
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto' }),
    );
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: createdId,
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      }),
    );
  });

  it("creates the crypto account first, then runs the wallet field's connect against its id", async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto' }),
    );
    // The wallet address is public, so it flows through the sync (no Keychain).
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: createdId,
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      }),
    );
  });

  it("creates the crypto account first, then runs the Binance field's connect against its id", async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'binance',
        targetAccountId: createdId,
      }),
    );
    // The secret never reaches this screen — BinanceCredentialsField owns the
    // Keychain write — so the screen calls neither saveToken nor saveCredentials.
    expect(mockSaveToken).not.toHaveBeenCalled();
  });

  it('does not create a DUPLICATE crypto account when a field Connect is followed by Save', async () => {
    // Connect-first: the field's own Connect already inserted the row. A subsequent
    // Save is the one write that finds that row and stores any later name/color/icon
    // edit on it, never a second account.
    storeCreatedRows();
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // Still exactly one Connect insert; the edited name is saved onto the row under its id.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdId, name: 'Renamed', color: null, bankId: null }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saves with the form id when a field-Connect create rejected, so Save is never a silent no-op', async () => {
    // A rejected insert (DB locked/disk full) leaves no row. Save is one write that creates the
    // row when it finds none, so it never takes an update that matches nothing and goes back
    // while no account exists.
    mockCreate.mockRejectedValueOnce(new Error('db locked'));
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    // The field's Connect fails cleanly (no unhandled rejection); nothing saved.
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(navigation.goBack).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: (mockCreate.mock.calls[0][0] as { id: string }).id,
        name: 'My Crypto',
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('locks the kind switch once a crypto source is connected, so Save cannot orphan the row', async () => {
    // Connecting a source inserts the crypto row. Switching to Bank/Cash
    // afterwards would route Save to a SECOND create and orphan that row, so the
    // kind field is disabled once connected — pressing it is inert, and Save
    // stays on the crypto UPDATE path.
    storeCreatedRows();
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    // The kind field is now disabled; pressing it never opens the sheet.
    expect(isKindFieldDisabled(getByTestId)).toBe(true);
    await fireEvent.press(getByTestId('account-kind-field'));
    expect(() => getByTestId('account-kind-field-option-bank')).toThrow();

    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // Still one Connect insert (crypto), no cash create, and Save saved onto the crypto row.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: (mockCreate.mock.calls[0][0] as { id: string }).id,
        kind: 'crypto',
      }),
    );
  });

  it('creates an unconnected crypto account on Save when no source was connected', async () => {
    // A crypto account is valid without a connected source (the user connects one
    // later from its detail screen). Save with no field Connect inserts the row
    // exactly once and never touches a credential write or sync. Validation of a
    // bad credential — and the skip-the-write-but-still-create guarantee — now
    // lives in BinanceCredentialsField's own test, not here.
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
  });
});

describe('AccountFormScreen — reminder to Connect a typed credential', () => {
  type FormView = Awaited<ReturnType<typeof renderForm>>;

  type SourceCase = {
    source: string;
    // Puts the form on the screen that shows this source's Connect field.
    open: (view: FormView) => Promise<void>;
    input: string;
    connectLabel: string;
    reminderTestID: string;
    // The Connect button the hint names, and what the hint reads in English.
    buttonLabelKey:
      | 'accountDetail.connectMonobank'
      | 'accountDetail.connectBinance'
      | 'accountDetail.connectWallet';
    hintText: string;
  };

  const openBank = async (view: FormView): Promise<void> => {
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
  };

  const openWallet = async (view: FormView): Promise<void> => {
    await selectKind(view.getByTestId, 'crypto');
  };

  const openBinance = async (view: FormView): Promise<void> => {
    await selectKind(view.getByTestId, 'crypto');
    await fireEvent.press(view.getByText('Binance'));
  };

  const sourceCases: SourceCase[] = [
    {
      source: 'Monobank token',
      open: openBank,
      input: 'monobank-token-input',
      connectLabel: 'monobank-field',
      reminderTestID: 'monobank-reminder',
      buttonLabelKey: 'accountDetail.connectMonobank',
      hintText: 'Tap “Connect Monobank” to link this account.',
    },
    {
      source: 'Binance key or secret',
      open: openBinance,
      input: 'binance-input',
      connectLabel: 'binance-field',
      reminderTestID: 'binance-reminder',
      buttonLabelKey: 'accountDetail.connectBinance',
      hintText: 'Tap “Connect Binance” to link this account.',
    },
    {
      source: 'wallet address',
      open: openWallet,
      input: 'wallet-input',
      connectLabel: 'wallet-field',
      reminderTestID: 'wallet-reminder',
      buttonLabelKey: 'accountDetail.connectWallet',
      hintText: 'Tap “Connect wallet” to link this account.',
    },
  ];

  // A named form with the source's Connect field showing and `typed` in its input.
  const fillForm = async (sourceCase: SourceCase, typed: string | null): Promise<FormView> => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Account');
    await sourceCase.open(view);

    if (typed !== null) {
      await fireEvent.changeText(view.getByTestId(sourceCase.input), typed);
    }

    return view;
  };

  const pressSave = async (view: FormView): Promise<void> => {
    await act(async () => {
      await fireEvent.press(view.getByText(i18n.t('common.save')));
    });
  };

  // The hint under the active language, naming the button the user sees.
  const hint = (sourceCase: SourceCase): string =>
    i18n.t('forms.account.connectHint', { label: i18n.t(sourceCase.buttonLabelKey) });

  // Presses the field's Connect and lets the connect run to its end.
  const connectAndSettle = async (view: FormView, sourceCase: SourceCase): Promise<void> => {
    await fireEvent.press(view.getByLabelText(sourceCase.connectLabel));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await act(async () => {});
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveFormAccount.mockResolvedValue('new-account-id');
    mockSetIcon.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
    mockSaveToken.mockResolvedValue(undefined);
    mockSaveCredentials.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
    mockCryptoSync.mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  describe.each(sourceCases)('$source', (sourceCase) => {
    it('blocks the first Save, shows the hint under Connect and scrolls to it', async () => {
      const view = await fillForm(sourceCase, 'typed');
      const scrollToFieldMock = scrollToField as jest.Mock;
      scrollToFieldMock.mockClear();

      await pressSave(view);

      expect(view.getByTestId(sourceCase.reminderTestID)).toHaveTextContent(sourceCase.hintText);
      expect(view.getByTestId(sourceCase.reminderTestID)).toHaveTextContent(hint(sourceCase));
      expect(view.navigation.goBack).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSaveFormAccount).not.toHaveBeenCalled();
      expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
      const [, reminderRef, , onSettled] = scrollToFieldMock.mock.calls[0];
      expect(reminderRef.current).not.toBeNull();
      expect(onSettled).toBeUndefined();
    });

    it('shows no hint before the first Save', async () => {
      const view = await fillForm(sourceCase, 'typed');

      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('saves the account unconnected on the second Save and stores nothing typed', async () => {
      const view = await fillForm(sourceCase, 'typed-secret-text');
      await pressSave(view);
      const scrollToFieldMock = scrollToField as jest.Mock;
      scrollToFieldMock.mockClear();

      await pressSave(view);

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
      expect(scrollToFieldMock).not.toHaveBeenCalled();
      expect(mockSaveToken).not.toHaveBeenCalled();
      expect(mockMonobankSync).not.toHaveBeenCalled();
      expect(mockCryptoSync).not.toHaveBeenCalled();
      expect(JSON.stringify(mockSaveFormAccount.mock.calls)).not.toContain('typed-secret-text');
    });

    it('saves on the first Save when the input is empty', async () => {
      const view = await fillForm(sourceCase, null);

      await pressSave(view);

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('saves on the first Save when the input is only whitespace', async () => {
      const view = await fillForm(sourceCase, '   ');

      await pressSave(view);

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('saves on the first Save once the source is connected', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await connectAndSettle(view, sourceCase);

      await pressSave(view);

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('takes the hint away when a pending connect succeeds after the hint showed', async () => {
      let resolveSync: (connected: boolean) => void = () => {};
      const pendingSync = new Promise<boolean>((resolve) => {
        resolveSync = resolve;
      });
      mockMonobankSync.mockReturnValue(pendingSync);
      mockCryptoSync.mockReturnValue(pendingSync);
      const view = await fillForm(sourceCase, 'typed');
      // The press settles only once the connect does, so it is awaited after the sync resolves.
      let connectPress: Promise<unknown> = Promise.resolve();
      await act(async () => {
        connectPress = fireEvent.press(view.getByLabelText(sourceCase.connectLabel));
      });
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      await pressSave(view);
      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();

      await act(async () => {
        resolveSync(true);
        await connectPress;
      });

      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('reminds again when a connected source is edited afterwards', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await connectAndSettle(view, sourceCase);

      await fireEvent.changeText(view.getByTestId(sourceCase.input), 'typed again');
      await pressSave(view);

      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();
      expect(view.navigation.goBack).not.toHaveBeenCalled();
    });

    it('still blocks the first Save after a Connect that failed', async () => {
      mockMonobankSync.mockResolvedValue(false);
      mockCryptoSync.mockResolvedValue(false);
      const view = await fillForm(sourceCase, 'typed');
      await fireEvent.press(view.getByLabelText(sourceCase.connectLabel));
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

      await pressSave(view);

      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();
      expect(view.navigation.goBack).not.toHaveBeenCalled();
    });

    it('hides the hint and starts over when the input is edited', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await pressSave(view);
      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();

      await fireEvent.changeText(view.getByTestId(sourceCase.input), 'typed more');

      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();

      await pressSave(view);

      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();
      expect(view.navigation.goBack).not.toHaveBeenCalled();
    });

    it('hides the hint and saves on the first Save once the input is cleared', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await pressSave(view);

      await fireEvent.changeText(view.getByTestId(sourceCase.input), '');

      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();

      await pressSave(view);

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
    });

    it('hides the hint and starts over when Connect is tapped', async () => {
      mockMonobankSync.mockResolvedValue(false);
      mockCryptoSync.mockResolvedValue(false);
      const view = await fillForm(sourceCase, 'typed');
      await pressSave(view);
      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();

      await fireEvent.press(view.getByLabelText(sourceCase.connectLabel));

      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();

      await pressSave(view);

      expect(view.getByTestId(sourceCase.reminderTestID)).toBeTruthy();
      expect(view.navigation.goBack).not.toHaveBeenCalled();
    });

    it('asks for the missing name before it reminds', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await fireEvent.changeText(view.getByLabelText('Name'), '');

      await pressSave(view);

      expect(view.queryByTestId('holding-identity-name-field-error')).toBeTruthy();
      expect(view.queryByTestId(sourceCase.reminderTestID)).toBeNull();
    });

    it('shows the hint in Ukrainian under the Ukrainian catalog', async () => {
      const view = await fillForm(sourceCase, 'typed');
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      await pressSave(view);

      const shown = view.getByTestId(sourceCase.reminderTestID);
      expect(shown).toHaveTextContent(hint(sourceCase));
      expect(shown).toHaveTextContent(/[А-Яа-яІіЇїЄє]/);
    });
  });

  it('reminds only about the source that is on screen after switching the crypto source', async () => {
    const view = await fillForm(sourceCases[2], 'typed');
    await pressSave(view);
    expect(view.getByTestId('wallet-reminder')).toBeTruthy();

    await fireEvent.press(view.getByText('Binance'));

    expect(view.queryByTestId('wallet-reminder')).toBeNull();

    await pressSave(view);

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it('forgets a typed token when the bank pick moves off Monobank', async () => {
    const view = await fillForm(sourceCases[0], 'typed');

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-other'));
    await pressSave(view);

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it('never reminds on the edit form', async () => {
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Ukrsibbank Card',
        kind: 'bank',
        icon: 'banknote',
        color: entityColors.violet,
        bankId: 'monobank',
      },
    ];
    const view = await renderForm({ accountId: 'acc-1' });

    await pressSave(view);

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(view.queryByTestId('monobank-reminder')).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('AccountFormScreen — draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveFormAccount.mockResolvedValue('new-account-id');
    mockCreateCashAccount.mockResolvedValue(undefined);
    mockSetIcon.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
    mockSaveToken.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
  });

  afterEach(() => {
    resetLayoutMode();
  });

  const savedDraft = {
    saved: true,
    name: 'Wallet',
    icon: 'giftcard',
    iconIsDirty: true,
    color: entityColors.violet,
    kind: 'cash',
    currency: 'EUR',
    initialValue: '250.50',
    bankId: null,
    brokerId: null,
    pendingAccountId: 'pending-1',
  } as const;

  type View = Awaited<ReturnType<typeof renderForm>>;

  const reopened = (view: View, opened: RouteParams = {}): Promise<View> =>
    renderForm(paramsAfter(view.navigation, opened) as RouteParams);

  it('brings back a half-filled cash account after a remount', async () => {
    const first = await renderForm();
    await fireEvent.changeText(first.getByLabelText('Name'), 'Wallet');
    await selectKind(first.getByTestId, 'cash');
    await fireEvent.changeText(first.getByLabelText('Initial value'), '250.50');
    await fireEvent.press(first.getByTestId('account-currency-field'));
    await fireEvent.changeText(first.getByPlaceholderText('Search by code or name'), 'EUR');
    await fireEvent.press(first.getByTestId('currency-option-EUR'));
    await fireEvent.press(first.getByLabelText('Color violet'));
    await fireEvent(first.getByLabelText('Initial value'), 'blur');
    await first.unmount();

    const second = await reopened(first);

    expect(second.getByLabelText('Name').props.value).toBe('Wallet');
    expect(second.getByTestId('account-kind-field')).toHaveTextContent('Cash');
    expect(second.getByLabelText('Initial value').props.value).toBe('250.50');
    expect(second.getByTestId('account-currency-field')).toHaveTextContent('Euro', {
      exact: false,
    });
    expect(second.getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(second.getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Wallet',
        currency: 'EUR',
        initialBalance: Money.of('EUR', 25050),
        color: entityColors.violet,
      }),
    );
  });

  it('brings back a bank account with its picked bank and icon', async () => {
    const first = await renderForm();
    await fireEvent.changeText(first.getByLabelText('Name'), 'Savings');
    await pickOtherBank(first.getByTestId);
    await fireEvent.press(first.getByLabelText('Change Icon'));
    await fireEvent.press(first.getByLabelText('Choose icon giftcard'));
    await fireEvent(first.getByLabelText('Name'), 'blur');
    await first.unmount();

    const second = await reopened(first);

    expect(second.getByLabelText('Name').props.value).toBe('Savings');
    expect(second.getByTestId('account-kind-field')).toHaveTextContent('Bank');
    expect(second.getByTestId('account-bank-type-field')).toHaveTextContent('Other bank');
    expect(second.getByLabelText('Icon giftcard')).toBeTruthy();
  });

  it('brings back the choices made since the last blur once the window changes shape', async () => {
    const first = await renderForm();
    await fireEvent.changeText(first.getByLabelText('Name'), 'Wallet');
    await selectKind(first.getByTestId, 'crypto');

    expect(first.navigation.setParams).not.toHaveBeenCalled();

    await emitLayoutMode('columns');
    await first.unmount();

    const second = await reopened(first);

    expect(second.getByLabelText('Name').props.value).toBe('Wallet');
    expect(second.getByTestId('account-kind-field')).toHaveTextContent('Crypto');
  });

  it('keeps the draft to plain values, so the route params stay JSON', async () => {
    const view = await renderForm();
    await fireEvent.changeText(view.getByLabelText('Name'), 'Savings');
    await fireEvent(view.getByLabelText('Name'), 'blur');

    const [[{ draft }]] = view.navigation.setParams.mock.calls;

    expect(draft).toEqual({
      saved: true,
      name: 'Savings',
      icon: accountKindSymbol.bank,
      iconIsDirty: false,
      color: null,
      kind: 'bank',
      currency: 'UAH',
      initialValue: '',
      bankId: null,
      brokerId: null,
      pendingAccountId: expect.any(String),
    });
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  it('writes the draft once per blur, never while typing', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'S');
    await fireEvent.changeText(view.getByLabelText('Name'), 'Sa');

    expect(view.navigation.setParams).not.toHaveBeenCalled();

    await fireEvent(view.getByLabelText('Name'), 'blur');

    expect(view.navigation.setParams).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a blur on a form the user has not changed', async () => {
    const view = await renderForm();

    await fireEvent(view.getByLabelText('Name'), 'blur');

    expect(view.navigation.setParams).not.toHaveBeenCalled();
  });

  describe('beside the identity a swap between the account and holding forms carries', () => {
    const carried = { name: 'Wallet', icon: 'giftcard', color: entityColors.violet };

    it('writes nothing for a blur on a form that only holds what the swap carried', async () => {
      const view = await renderForm({ initialKind: 'cash', draft: carried });

      await fireEvent(view.getByLabelText('Name'), 'blur');

      expect(view.navigation.setParams).not.toHaveBeenCalled();
    });

    it('writes the whole form over what the swap carried once the user changes a field', async () => {
      const view = await renderForm({ initialKind: 'cash', draft: carried });
      await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet 2');
      await fireEvent(view.getByLabelText('Name'), 'blur');

      expect(view.navigation.setParams).toHaveBeenCalledTimes(1);
      expect(view.navigation.setParams).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          saved: true,
          name: 'Wallet 2',
          icon: 'giftcard',
          iconIsDirty: true,
          color: entityColors.violet,
          kind: 'cash',
        }),
      });
    });

    it('opens on the saved draft, not on the initial kind the swap named', async () => {
      const view = await renderForm({ initialKind: 'crypto', draft: savedDraft });

      expect(view.getByTestId('account-kind-field')).toHaveTextContent('Cash');
      expect(view.getByLabelText('Name').props.value).toBe('Wallet');
    });

    it('still swaps forward with the identity of the form as it stands', async () => {
      const view = await renderForm({ draft: savedDraft });

      await selectKind(view.getByTestId, 'property');

      expect(view.navigation.replace).toHaveBeenCalledWith('HoldingForm', {
        implicitKind: 'property',
        draft: { name: 'Wallet', icon: 'giftcard', color: entityColors.violet },
      });
    });
  });

  describe('an edit', () => {
    beforeEach(() => {
      mockAccounts = [
        {
          id: 'acc-1',
          name: 'Ukrsibbank Card',
          kind: 'bank',
          icon: 'banknote',
          color: entityColors.violet,
          bankId: null,
        },
      ];
    });

    it('lets the draft win over the stored account it was opened on', async () => {
      const first = await renderForm({ accountId: 'acc-1' });
      await fireEvent.changeText(first.getByLabelText('Name'), 'Renamed card');
      await fireEvent(first.getByLabelText('Name'), 'blur');
      await first.unmount();

      const second = await reopened(first, { accountId: 'acc-1' });

      expect(second.getByLabelText('Name').props.value).toBe('Renamed card');
      expect(second.getByLabelText('Icon banknote')).toBeTruthy();

      await fireEvent.press(second.getByText('Save'));

      expect(mockUpdate).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ name: 'Renamed card' }),
      );
    });

    it('opens from the stored account when the route carries no draft', async () => {
      const view = await renderForm({ accountId: 'acc-1' });

      expect(view.getByLabelText('Name').props.value).toBe('Ukrsibbank Card');
    });
  });

  const fillMonobank = async (view: View, name: string): Promise<void> => {
    await fireEvent.changeText(view.getByLabelText('Name'), name);
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
  };

  it('saves onto the row a Connect inserts after the form was folded, never failing or creating a second', async () => {
    let finishInsert = (): void => undefined;
    storeCreatedRows(
      new Promise<void>((resolve) => {
        finishInsert = resolve;
      }),
    );
    const first = await renderForm();
    await fillMonobank(first, 'My Bank');
    // The old screen's Connect queues its insert before the fold, and that insert is still
    // waiting when the new form opens.
    const connectOfFoldedForm = mockMonobankConnect as (token: string) => Promise<boolean>;
    let connected: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      connected = connectOfFoldedForm('tok-123');
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await emitLayoutMode('columns');
    await first.unmount();
    const second = await reopened(first);

    await act(async () => finishInsert());

    expect(await connected).toBe(true);

    await fireEvent.press(second.getByText('Save'));

    await waitFor(() => expect(second.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdId, name: 'My Bank', bankId: 'monobank' }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();

    await fireEvent.press(second.getByLabelText('monobank-field'));

    await waitFor(() =>
      expect(second.getByTestId('monobank-connect-result')).toHaveTextContent('true'),
    );
    expect(mockAccounts).toHaveLength(1);
  });

  it('keeps the rename a Save made while the Connect insert of the folded form was still queued', async () => {
    let finishInsert = (): void => undefined;
    storeCreatedRows(
      new Promise<void>((resolve) => {
        finishInsert = resolve;
      }),
    );
    const first = await renderForm();
    await fillMonobank(first, 'My Bank');
    const connectOfFoldedForm = mockMonobankConnect as (token: string) => Promise<boolean>;
    let connected: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      connected = connectOfFoldedForm('tok-123');
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await emitLayoutMode('columns');
    await first.unmount();
    const second = await reopened(first);
    await fireEvent.changeText(second.getByLabelText('Name'), 'Renamed bank');
    // The Save is issued while that insert is still waiting: its write queues behind the insert.
    let savePress: Promise<unknown> = Promise.resolve();
    await act(async () => {
      savePress = fireEvent.press(second.getByText('Save'));
    });

    await act(async () => {
      finishInsert();
      await savePress;
    });

    expect(await connected).toBe(true);
    expect(second.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdId, name: 'Renamed bank' }),
    );
    expect(mockAccounts).toEqual([{ id: createdId, name: 'Renamed bank' }]);
  });

  it('connects again on the remounted form onto the row that is stored, adding no second', async () => {
    storeCreatedRows();
    const first = await renderForm();
    await fillMonobank(first, 'My Bank');
    await fireEvent.press(first.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(1));
    await emitLayoutMode('columns');
    await first.unmount();
    const second = await reopened(first);

    await fireEvent.press(second.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(second.getByTestId('monobank-connect-result')).toHaveTextContent('true'),
    );
    expect(mockAccounts).toHaveLength(1);
  });

  it('creates the row again on Save when it was deleted elsewhere after a Connect inserted it', async () => {
    storeCreatedRows();
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();
    await fillMonobank(view, 'My Bank');
    await fireEvent.press(view.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(1));
    const pendingId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    mockAccounts = [];

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: pendingId, name: 'My Bank' }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAccounts).toEqual([{ id: pendingId, name: 'My Bank' }]);
  });

  it('creates the row on Save when the insert a fold interrupted failed', async () => {
    let failInsert = (): void => undefined;
    mockCreate.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failInsert = () => reject(new Error('database is locked'));
        }),
    );
    const first = await renderForm();
    await fillMonobank(first, 'My Bank');
    let connected: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      connected = (mockMonobankConnect as (token: string) => Promise<boolean>)('tok-123');
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const pendingId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await emitLayoutMode('columns');
    await first.unmount();
    const second = await reopened(first);
    await act(async () => failInsert());

    expect(await connected).toBe(false);

    expect(isKindFieldDisabled(second.getByTestId)).toBe(false);

    await fireEvent.press(second.getByText('Save'));

    await waitFor(() => expect(second.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: pendingId, name: 'My Bank' }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps the row a Connect already created, so the remount saves onto it and never creates a second', async () => {
    storeCreatedRows();
    mockMonobankSync.mockResolvedValue(true);
    const first = await renderForm();
    await fireEvent.changeText(first.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(first.getByLabelText('Bank type'));
    await fireEvent.press(first.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(first.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await emitLayoutMode('columns');
    await first.unmount();

    const second = await reopened(first);

    expect(isKindFieldDisabled(second.getByTestId)).toBe(true);

    await fireEvent.press(second.getByText('Save'));

    await waitFor(() => expect(second.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdId, name: 'My Bank', bankId: 'monobank' }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // The remounted form reads its draft at once, but the live query shows a row the screen a fold
  // replaced has queued only once that insert lands. Until the write queue answers whether the
  // pending row exists, the picks that send Save down another path stay locked.
  describe('right after a fold, before the queue says whether the pending row exists', () => {
    const bankDraft = {
      ...savedDraft,
      name: 'My Bank',
      icon: accountKindSymbol.bank,
      iconIsDirty: false,
      color: null,
      kind: 'bank',
      currency: 'UAH',
      initialValue: '',
      bankId: 'monobank',
    } as const;

    const isBankFieldDisabled = (view: View): boolean =>
      Boolean(view.getByTestId('account-bank-type-field').props.accessibilityState.disabled);

    const holdQueue = (): { answer: () => void; fail: () => void } => {
      const settle = { answer: (): void => undefined, fail: (): void => undefined };
      mockQueueEnds = new Promise<void>((resolve, reject) => {
        settle.answer = resolve;
        settle.fail = () => reject(new Error('database is locked'));
      });

      return settle;
    };

    it('locks the kind and bank picks until the queue answers, then unlocks them when no row is stored', async () => {
      const queue = holdQueue();

      const view = await renderForm({ draft: bankDraft });

      expect(mockExistsCalls).toEqual(['pending-1']);
      expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
      expect(isBankFieldDisabled(view)).toBe(true);
      await fireEvent.press(view.getByTestId('account-kind-field'));
      expect(() => view.getByTestId('account-kind-field-option-cash')).toThrow();
      await fireEvent.press(view.getByTestId('account-bank-type-field'));
      expect(() => view.getByTestId('bank-type-option-other')).toThrow();

      await act(async () => queue.answer());

      expect(isKindFieldDisabled(view.getByTestId)).toBe(false);
      expect(isBankFieldDisabled(view)).toBe(false);
      await selectKind(view.getByTestId, 'cash');
      expect(view.getByTestId('account-kind-field')).toHaveTextContent('Cash');
    });

    it('keeps them locked when the queue says the row is stored, before the live query shows it', async () => {
      const queue = holdQueue();
      mockExistsAnswer = true;
      const view = await renderForm({ draft: bankDraft });

      await act(async () => queue.answer());

      expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
      expect(isBankFieldDisabled(view)).toBe(true);
    });

    it('keeps them locked when the read fails, and the form still saves as a bank', async () => {
      const queue = holdQueue();
      const view = await renderForm({ draft: bankDraft });

      await act(async () => queue.fail());

      expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
      expect(isBankFieldDisabled(view)).toBe(true);

      await fireEvent.press(view.getByText('Save'));

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockSaveFormAccount).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pending-1', kind: 'bank', bankId: 'monobank' }),
      );
    });

    it.each(['cash', 'crypto'] as const)(
      'cannot switch a Connect the fold interrupted to %s: one account, with its own kind and bank',
      async (pickedKind) => {
        let finishInsert = (): void => undefined;
        storeCreatedRows(
          new Promise<void>((resolve) => {
            finishInsert = resolve;
          }),
        );
        const first = await renderForm();
        await fillMonobank(first, 'My Bank');
        const connectOfFoldedForm = mockMonobankConnect as (token: string) => Promise<boolean>;
        // The write queue is first in, first out: the screen the fold replaced queued its insert
        // before the new form opened, so the new form's read comes after it.
        let connected: Promise<boolean> = Promise.resolve(false);
        await act(async () => {
          connected = connectOfFoldedForm('tok-123');
        });
        await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
        const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
        await emitLayoutMode('columns');
        await first.unmount();
        const second = await reopened(first);

        // The insert is still queued: the live query shows no row yet.
        expect(mockAccounts).toEqual([]);
        await fireEvent.press(second.getByTestId('account-kind-field'));
        expect(() => second.getByTestId(`account-kind-field-option-${pickedKind}`)).toThrow();
        let savePress: Promise<unknown> = Promise.resolve();
        await act(async () => {
          savePress = fireEvent.press(second.getByText('Save'));
        });
        await act(async () => {
          finishInsert();
          await savePress;
        });

        expect(await connected).toBe(true);
        expect(mockCreateCashAccount).not.toHaveBeenCalled();
        expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
        expect(mockSaveFormAccount).toHaveBeenCalledWith(
          expect.objectContaining({ id: createdId, kind: 'bank', bankId: 'monobank' }),
        );
        expect(mockAccounts).toEqual([{ id: createdId, name: 'My Bank' }]);
      },
    );

    it('asks nothing of a form that was not remounted from its own draft', async () => {
      const fresh = await renderForm();
      const swapped = await renderForm({
        initialKind: 'cash',
        draft: { name: 'Wallet', icon: 'giftcard', color: entityColors.violet },
      });

      expect(mockExistsCalls).toEqual([]);
      expect(isKindFieldDisabled(fresh.getByTestId)).toBe(false);
      expect(isKindFieldDisabled(swapped.getByTestId)).toBe(false);
    });

    it('asks nothing of an edit, which locks the kind by itself', async () => {
      mockAccounts = [{ id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null }];

      const view = await renderForm({ accountId: 'acc-1', draft: bankDraft });

      expect(mockExistsCalls).toEqual([]);
      expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
    });
  });

  // A Connect field the screen replaced (a fold, or a kind or bank switch that removes it) never
  // connects: its token check may resolve later, and the connect it ran would insert the pending
  // row after the form already decided what to write. The real field is rendered here, because
  // its own unmount guard is what is under test.
  describe('a token check that a fold or a switch interrupts', () => {
    const typeTokenAndConnect = async (view: View): Promise<void> => {
      await fireEvent.changeText(
        view.getByPlaceholderText(i18n.t('accountDetail.monobankTokenPlaceholder')),
        'tok-123',
      );
      await act(async () => {
        await fireEvent.press(view.getByText(i18n.t('accountDetail.connectMonobank')));
      });
    };

    const holdTokenCheck = (): { finish: () => Promise<void> } => {
      const check = { finish: async (): Promise<void> => undefined };
      mockFetchClientInfo.mockImplementation(
        () =>
          new Promise((resolve) => {
            check.finish = () =>
              act(async () => {
                resolve({ name: 'Ada' });
              });
          }),
      );

      return check;
    };

    beforeEach(() => {
      mockUsesRealMonobankField = true;
      storeCreatedRows();
    });

    it('writes no row and saves one cash account when the kind is switched during the check', async () => {
      const check = holdTokenCheck();
      const view = await renderForm();
      await fillMonobank(view, 'My Bank');
      await typeTokenAndConnect(view);

      await selectKind(view.getByTestId, 'cash');
      await check.finish();

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSaveToken).not.toHaveBeenCalled();
      expect(mockMonobankSync).not.toHaveBeenCalled();

      await fireEvent.changeText(view.getByLabelText('Initial value'), '100');
      await fireEvent.press(view.getByText('Save'));

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);
      expect(mockSaveFormAccount).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('writes no row and saves no Monobank row when the bank is switched during the check', async () => {
      const check = holdTokenCheck();
      const view = await renderForm();
      await fillMonobank(view, 'My Bank');
      await typeTokenAndConnect(view);

      await pickOtherBank(view.getByTestId);
      await check.finish();

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSaveToken).not.toHaveBeenCalled();

      await fireEvent.press(view.getByText('Save'));

      await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
      expect(mockSaveFormAccount).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'bank', bankId: 'other' }),
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockAccounts).toHaveLength(1);
    });

    it('lets the folded form unlock its picks and save one cash account, whatever the old check does', async () => {
      const check = holdTokenCheck();
      const first = await renderForm();
      await fillMonobank(first, 'My Bank');
      await typeTokenAndConnect(first);
      await emitLayoutMode('columns');
      await first.unmount();
      const second = await reopened(first);

      await waitFor(() => expect(isKindFieldDisabled(second.getByTestId)).toBe(false));
      await check.finish();

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSaveToken).not.toHaveBeenCalled();
      expect(mockMonobankSync).not.toHaveBeenCalled();
      expect(isKindFieldDisabled(second.getByTestId)).toBe(false);

      await selectKind(second.getByTestId, 'cash');
      await fireEvent.changeText(second.getByLabelText('Initial value'), '100');
      await fireEvent.press(second.getByText('Save'));

      await waitFor(() => expect(second.navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);
      expect(mockSaveFormAccount).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('still connects when the form stays mounted: one row, the token stored, the sync run', async () => {
      const check = holdTokenCheck();
      const view = await renderForm();
      await fillMonobank(view, 'My Bank');
      await typeTokenAndConnect(view);

      await check.finish();

      await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockSaveToken).toHaveBeenCalledTimes(1);
      expect(mockAccounts).toHaveLength(1);
    });
  });

  it('leaves no draft behind once saved: it goes back and writes nothing more', async () => {
    const view = await renderForm({ draft: savedDraft });
    await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet 2');
    await fireEvent(view.getByLabelText('Name'), 'blur');
    view.navigation.setParams.mockClear();

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalledTimes(1));
    expect(view.navigation.setParams).not.toHaveBeenCalled();
  });
});

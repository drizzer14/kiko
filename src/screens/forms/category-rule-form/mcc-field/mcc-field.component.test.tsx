import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Keyboard } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import MccField from './mcc-field.component';
import type { MccFieldProps } from './mcc-field.props';

type OwnRow = { mcc: number; rowCount: number };

type RowsInput = { ownLoading: boolean };

let mockOwnRows: OwnRow[] = [];
let mockOwnLoading = false;
let mockEnabledArguments: unknown[] = [];
let mockRowsInputs: RowsInput[] = [];

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    mccCountsQuery: () => ({ __kind: 'mccCounts', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }, _keys: string[], enabled = true) => {
    if (query.__kind === 'mccCounts') {
      mockEnabledArguments.push(enabled);

      return enabled
        ? { data: mockOwnRows, isLoading: mockOwnLoading, isFresh: true }
        : { data: [], isLoading: false, isFresh: true };
    }

    return { data: [], isLoading: false, isFresh: true };
  },
}));

jest.mock('./mcc-picker-rows', () => {
  const actual = jest.requireActual('./mcc-picker-rows');

  return {
    ...actual,
    mccPickerRows: (input: RowsInput) => {
      mockRowsInputs.push(input);

      return actual.mccPickerRows(input);
    },
  };
});

type Screen = Awaited<ReturnType<typeof render>>;

const GROCERY = 'Grocery Stores, Supermarkets';

const SEARCH_PLACEHOLDER = 'Search by code or name';

const TYPED_LABEL = 'Four-digit code';

const renderField = async (overrides: Partial<MccFieldProps> = {}) => {
  return render(
    <MccField value="" onChange={jest.fn()} error={undefined} testID="mcc-field" {...overrides} />,
  );
};

const open = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByTestId('mcc-field'));
};

const search = async (screen: Screen, query: string): Promise<void> => {
  await fireEvent.changeText(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), query);
};

const setLanguage = async (language: 'en' | 'uk'): Promise<void> => {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
};

beforeEach(() => {
  mockOwnRows = [
    { mcc: 5411, rowCount: 12 },
    { mcc: 5812, rowCount: 3 },
  ];
  mockOwnLoading = false;
  mockEnabledArguments = [];
  mockRowsInputs = [];
});

afterEach(async () => {
  await setLanguage('en');
});

describe('MccField', () => {
  it('shows the placeholder, a listed code with its name, and an unlisted code as its digits', async () => {
    const empty = await renderField({ value: '' });

    expect(empty.getByText('Select a code')).toBeTruthy();

    await empty.unmount();

    const listed = await renderField({ value: '5411' });

    expect(listed.getByText(`5411 – ${GROCERY}`)).toBeTruthy();

    await listed.unmount();

    const unlisted = await renderField({ value: '0042' });

    expect(unlisted.getByText('0042')).toBeTruthy();
    expect(unlisted.queryByText('Select a code')).toBeNull();
  });

  it('reads the own codes only while the sheet is open', async () => {
    const screen = await renderField();

    expect(mockEnabledArguments.length).toBeGreaterThan(0);
    expect(new Set(mockEnabledArguments)).toEqual(new Set([false]));

    await open(screen);

    expect(mockEnabledArguments.at(-1)).toBe(true);
  });

  it('shows no empty text while the sheet closes', async () => {
    mockOwnRows = [];
    mockOwnLoading = false;

    await renderField();

    expect(mockRowsInputs.length).toBeGreaterThan(0);
    expect(mockRowsInputs.every(({ ownLoading }) => ownLoading)).toBe(true);
  });

  it('shows the empty text once the sheet is open and the read landed with no codes', async () => {
    mockOwnRows = [];
    mockOwnLoading = false;

    const screen = await renderField();
    await open(screen);

    expect(mockRowsInputs.at(-1)?.ownLoading).toBe(false);
    expect(screen.getByTestId('mcc-own-empty')).toHaveTextContent(
      'No codes in your transactions yet. Syncs and statements from some banks add them.',
    );
  });

  it('picks an own code on the first tap with the keyboard up', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const onChange = jest.fn();
    const screen = await renderField({ onChange });
    await open(screen);

    expect(screen.getByTestId('mcc-picker-list').props.keyboardShouldPersistTaps).toBe('handled');

    await search(screen, '58');
    await fireEvent.press(screen.getByTestId('mcc-own-5812'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('5812');
    expect(dismiss).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();

    await open(screen);

    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER).props.value).toBe('');

    dismiss.mockRestore();
  });

  it('picks a code from the full list', async () => {
    const onChange = jest.fn();
    const screen = await renderField({ onChange });
    await open(screen);
    await search(screen, '0742');
    await fireEvent.press(screen.getByTestId('mcc-all-0742'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('0742');
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();

    await open(screen);

    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER).props.value).toBe('');
  });

  it('Other code opens the typed field seeded with the digits of the query', async () => {
    const onChange = jest.fn();
    const screen = await renderField({ value: '0042', onChange });
    await open(screen);
    await search(screen, '54');
    await fireEvent.press(screen.getByTestId('mcc-other-row'));

    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    expect(screen.getByLabelText(TYPED_LABEL).props.value).toBe('54');
    expect(onChange).toHaveBeenCalledWith('54');
  });

  it('Other code opens the typed field with the current code when the query is not digits', async () => {
    const screen = await renderField({ value: '0042' });
    await open(screen);
    await search(screen, 'grocery');
    await fireEvent.press(screen.getByTestId('mcc-other-row'));

    expect(screen.getByLabelText(TYPED_LABEL).props.value).toBe('0042');
  });

  it('filters the typed field to digits and four at most', async () => {
    const onChange = jest.fn();
    const screen = await renderField({ value: '54', onChange });

    await fireEvent.changeText(screen.getByTestId('mcc-typed-field'), 'a1b2c3d4e5');

    expect(onChange).toHaveBeenCalledWith('1234');
  });

  it('starts typing for a half-typed code and not for a four-digit one', async () => {
    const half = await renderField({ value: '54' });

    expect(half.getByLabelText(TYPED_LABEL).props.value).toBe('54');

    await half.unmount();

    const full = await renderField({ value: '5411' });

    expect(full.queryByTestId('mcc-typed-field')).toBeNull();

    await full.unmount();

    const blank = await renderField({ value: '' });

    expect(blank.queryByTestId('mcc-typed-field')).toBeNull();
  });

  it('shows the error under the typed field while typing and under the trigger otherwise', async () => {
    const message = 'Select a code or enter four digits.';
    const typing = await renderField({ value: '54', error: message });

    expect(typing.getByTestId('mcc-typed-field-error')).toHaveTextContent(message);
    expect(typing.queryByTestId('mcc-field-error')).toBeNull();

    await typing.unmount();

    const idle = await renderField({ value: '', error: message });

    expect(idle.getByTestId('mcc-field-error')).toHaveTextContent(message);
    expect(idle.queryByTestId('mcc-typed-field-error')).toBeNull();
  });

  it.each([
    ['en', ['1 transaction', '2 transactions', '5 transactions', '21 transactions']],
    ['uk', ['1 транзакція', '2 транзакції', '5 транзакцій', '21 транзакція']],
  ] as const)('shows the own count as a plural in %s (1, 2, 5, 21)', async (language, texts) => {
    const codes = ['5411', '5812', '5732', '4814'];

    mockOwnRows = [
      { mcc: 5411, rowCount: 1 },
      { mcc: 5812, rowCount: 2 },
      { mcc: 5732, rowCount: 5 },
      { mcc: 4814, rowCount: 21 },
    ];
    await setLanguage(language);

    const screen = await renderField();
    await open(screen);

    codes.forEach((code, index) => {
      expect(screen.getByTestId(`mcc-own-${code}-description`)).toHaveTextContent(texts[index]);
    });
  });

  it('labels rows for VoiceOver', async () => {
    const screen = await renderField();
    await open(screen);

    expect(screen.getByTestId('mcc-own-5411').props.accessibilityLabel).toBe(
      `5411, ${GROCERY}, 12 transactions`,
    );
    expect(screen.getByTestId('mcc-own-5411').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('mcc-other-row').props.accessibilityLabel).toBe(
      'Other code, Type any four-digit code.',
    );
    expect(screen.getByTestId('mcc-other-row').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('mcc-heading-own').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('mcc-heading-all').props.accessibilityRole).toBe('header');

    await search(screen, '0742');

    expect(screen.getByTestId('mcc-all-0742').props.accessibilityLabel).toBe(
      '0742, Veterinary Services',
    );
    expect(screen.getByTestId('mcc-all-0742').props.accessibilityRole).toBe('button');
  });

  it('marks the picked code selected in both sections', async () => {
    const screen = await renderField({ value: '5411' });
    await open(screen);
    await search(screen, '5411');

    const selectedOf = (testID: string): unknown =>
      screen.getByTestId(testID).props.accessibilityState?.selected;

    expect(selectedOf('mcc-own-5411')).toBe(true);
    expect(selectedOf('mcc-all-5411')).toBe(true);

    await search(screen, '5812');

    expect(selectedOf('mcc-own-5812')).toBe(false);
  });
});

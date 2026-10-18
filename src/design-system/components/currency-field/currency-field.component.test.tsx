import { Keyboard } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
// Real i18n init (side effect), same as App.tsx, so the search placeholder's
// `t(...)` resolves under test the same way it does at runtime.
import '@kiko/i18n/init';
import { currencyOptions, fiatCurrencyOptions } from '@kiko/currency/currency';

import CurrencyField from '.';
import type { CurrencyFieldProps } from './currency-field.props';

const renderCurrencyField = (overrides: Partial<CurrencyFieldProps> = {}) =>
  render(
    <CurrencyField
      label="Currency"
      sheetTitle="Select a Currency"
      selected="UAH"
      onSelect={jest.fn()}
      groups={[{ kind: 'fiat', currencies: currencyOptions }]}
      testID="currency-field"
      {...overrides}
    />,
  );

// Every heading and currency row on screen, in render order.
const listedIds = (utils: Awaited<ReturnType<typeof render>>): string[] =>
  utils
    .getAllByTestId(/^currency-(group|option)-/)
    .map((row) => String(row.props.testID).replace('currency-', ''));

const coinsThenCurrencies: CurrencyFieldProps['groups'] = [
  { kind: 'crypto', currencies: ['ETH', 'BTC'] },
  { kind: 'fiat', currencies: ['UAH', 'ARS'] },
];

const open = async (utils: Awaited<ReturnType<typeof render>>): Promise<void> => {
  await fireEvent.press(utils.getByTestId('currency-field'));
};

const search = async (utils: Awaited<ReturnType<typeof render>>, query: string): Promise<void> => {
  await fireEvent.changeText(utils.getByPlaceholderText('Search by code or name'), query);
};

describe('CurrencyField', () => {
  it('reports the picked currency and closes the sheet', async () => {
    const onSelect = jest.fn();
    const utils = await renderCurrencyField({ onSelect });
    await open(utils);
    // Narrow by search first: unfiltered, USD sorts alphabetically by its
    // localized name ("US Dollar") well outside the FlatList's virtualized
    // initial window (`initialNumToRender={15}`).
    await search(utils, 'USD');
    await fireEvent.press(utils.getByTestId('currency-option-USD'));
    expect(onSelect).toHaveBeenCalledWith('USD');
  });

  it('renders the field error under the trigger, matching FieldTrigger', async () => {
    const utils = await renderCurrencyField({ error: 'Choose USD.' });

    expect(utils.getByTestId('currency-field-error')).toHaveTextContent('Choose USD.');
  });

  it('renders no error node while the field is valid', async () => {
    const utils = await renderCurrencyField();

    expect(utils.queryByTestId('currency-field-error')).toBeNull();
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const utils = await renderCurrencyField();

    expect(utils.queryByText('Select a Currency')).toBeNull();

    await open(utils);

    expect(utils.queryByText('Select a Currency')).toBeTruthy();
  });

  it('filters the list by code', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'chf');
    expect(utils.getByTestId('currency-option-CHF')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('filters the list by name', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'pound');
    expect(utils.getByTestId('currency-option-GBP')).toBeTruthy();
    expect(utils.queryByTestId('currency-option-EUR')).toBeNull();
  });

  it('restricts the list to the given groups (fiat only offers no BTC)', async () => {
    const utils = await renderCurrencyField({
      groups: [{ kind: 'fiat', currencies: fiatCurrencyOptions }],
    });
    await open(utils);
    // Narrow by search: unfiltered, USD sorts near the end of the alphabetized
    // fiat list and falls outside the FlatList's virtualized initial window.
    await search(utils, 'USD');
    expect(utils.queryByTestId('currency-option-BTC')).toBeNull();
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  it('shows the text currency mark for the trigger and each option (never a generic icon)', async () => {
    const utils = await renderCurrencyField({ selected: 'USD' });

    // The trigger's own leading mark ("$" for USD) — proves CurrencyField
    // swapped from the SF Symbol `icon` path onto the text `leadingText` path.
    expect(utils.getByText('$')).toBeTruthy();

    await open(utils);
    // AED has no conventional Unicode symbol, so its mark is the bare ISO
    // code — this is exactly the case the old SF-Symbol map fell back to the
    // generic `banknote` glyph for. Narrow by search first: unfiltered, AED's
    // localized name ("UAE Dirham") sorts outside the virtualized window.
    await search(utils, 'AED');

    expect(utils.getByTestId('currency-option-AED')).toBeTruthy();
  });

  // The search TextField inside the sheet leaves the keyboard up (and the
  // background form scrolled) after a currency is picked unless `handleSelect`
  // or the sheet's dismiss calls `Keyboard.dismiss()`.
  it('dismisses the keyboard when a currency is selected', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'USD');
    await fireEvent.press(utils.getByTestId('currency-option-USD'));

    expect(dismissSpy).toHaveBeenCalled();

    dismissSpy.mockRestore();
  });

  // With the keyboard up (the search field focused), the FIRST
  // tap on a currency row would only dismiss the keyboard — the list's default
  // `keyboardShouldPersistTaps` ("never") swallows that first tap as a
  // keyboard-dismiss instead of delivering it to the row's `onPress`, so a
  // SECOND tap was needed to actually select. "handled" (the same fix
  // `screen.component.tsx`'s own background ScrollView already uses) fires
  // the row's `onPress` on the first tap while still dismissing the keyboard
  // on a tap to an inert area of the list.
  it('lets a single tap select a currency row while the keyboard is still up', async () => {
    const utils = await renderCurrencyField();
    await open(utils);

    expect(utils.getByTestId('currency-picker-list').props.keyboardShouldPersistTaps).toBe(
      'handled',
    );
  });

  // Same device bug: dismissing the sheet WITHOUT picking a currency (the
  // scrim/back dismiss) must also drop the keyboard, or a search left focused
  // keeps the background scrolled even after the sheet itself closes.
  it('dismisses the keyboard when the sheet is dismissed without a selection', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const utils = await renderCurrencyField();
    await open(utils);
    await fireEvent.press(utils.getByTestId('currency-picker-sheet-backdrop'));

    expect(dismissSpy).toHaveBeenCalled();

    dismissSpy.mockRestore();
  });

  it('does not open the sheet when disabled', async () => {
    const utils = await renderCurrencyField({ selected: 'BTC', disabled: true });
    await open(utils);
    expect(utils.queryByTestId('currency-option-USD')).toBeNull();
  });

  it('renders a group in the order it was given, never re-sorting it', async () => {
    // ARS ("Argentine Peso") sorts before UAH by name, and AOA before DZD by code: the
    // given order wins over both, because ordering is the group builder's job.
    const utils = await renderCurrencyField({
      groups: [{ kind: 'fiat', currencies: ['UAH', 'ARS', 'AOA', 'DZD'] }],
    });
    await open(utils);

    expect(listedIds(utils)).toEqual(['option-UAH', 'option-ARS', 'option-AOA', 'option-DZD']);
  });

  it('keeps the given group order while searching', async () => {
    // "t" is in the codes ETH and BTC, and in "Argentine Peso"; UAH and its name have none.
    const utils = await renderCurrencyField({ groups: coinsThenCurrencies });
    await open(utils);
    await search(utils, 't');

    expect(listedIds(utils)).toEqual([
      'group-crypto',
      'option-ETH',
      'option-BTC',
      'group-fiat',
      'option-ARS',
    ]);
  });

  it('lists each group under its own heading, in the order the groups were given', async () => {
    const utils = await renderCurrencyField({ groups: coinsThenCurrencies });
    await open(utils);

    expect(listedIds(utils)).toEqual([
      'group-crypto',
      'option-ETH',
      'option-BTC',
      'group-fiat',
      'option-UAH',
      'option-ARS',
    ]);
  });

  it('shows a heading per group when two groups are shown', async () => {
    const utils = await renderCurrencyField({ groups: coinsThenCurrencies });
    await open(utils);

    expect(utils.getByTestId('currency-group-crypto')).toHaveTextContent('Crypto');
    expect(utils.getByTestId('currency-group-fiat')).toHaveTextContent('Currencies');
    expect(utils.getByTestId('currency-group-crypto')).toHaveProp('accessibilityRole', 'header');
  });

  it('labels the target and held headings', async () => {
    const utils = await renderCurrencyField({
      groups: [
        { kind: 'target', currencies: ['EUR'] },
        { kind: 'held', currencies: ['USD'] },
      ],
    });
    await open(utils);

    expect(utils.getByTestId('currency-group-target')).toHaveTextContent('Holding currency');
    expect(utils.getByTestId('currency-group-held')).toHaveTextContent('Your currencies');
  });

  it('shows no heading for a single group', async () => {
    const utils = await renderCurrencyField({
      groups: [{ kind: 'fiat', currencies: ['UAH', 'ARS'] }],
    });
    await open(utils);

    expect(utils.queryByTestId('currency-group-fiat')).toBeNull();
    expect(listedIds(utils)).toEqual(['option-UAH', 'option-ARS']);
  });

  it('hides a group the search empties, and drops headings once one group is left', async () => {
    const utils = await renderCurrencyField({ groups: coinsThenCurrencies });
    await open(utils);

    expect(utils.getByTestId('currency-group-fiat')).toBeTruthy();

    await search(utils, 'BTC');

    expect(utils.queryByTestId('currency-group-fiat')).toBeNull();
    expect(utils.queryByTestId('currency-group-crypto')).toBeNull();
    expect(listedIds(utils)).toEqual(['option-BTC']);
  });

  it('search spans every group', async () => {
    // "i" is in "Bitcoin" and "Ukrainian Hryvnia", not in "US Dollar".
    const utils = await renderCurrencyField({
      groups: [
        { kind: 'crypto', currencies: ['BTC'] },
        { kind: 'fiat', currencies: ['UAH', 'USD'] },
      ],
    });
    await open(utils);
    await search(utils, 'i');

    expect(listedIds(utils)).toEqual(['group-crypto', 'option-BTC', 'group-fiat', 'option-UAH']);
  });

  it('resets the search on close', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'USD');
    await fireEvent.press(utils.getByTestId('currency-picker-sheet-backdrop'));
    await open(utils);

    expect(utils.getByPlaceholderText('Search by code or name').props.value).toBe('');
  });

  it('finds a currency by searching its ISO code', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'USD');
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
    expect(utils.getByText('US Dollar')).toBeTruthy();
  });

  it('finds a currency by searching its localized name', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'dollar');
    expect(utils.getByTestId('currency-option-USD')).toBeTruthy();
  });

  // The trigger's own displayed value must not read "CODE — Name" (e.g.
  // "USD — US Dollar"): that duplicates the ISO code
  // that already sits in the trigger's separate `leadingText` mark. The
  // trigger must mirror the option rows exactly: the localized NAME only.
  it('does not show the ISO code in the trigger value, only the localized name', async () => {
    const utils = await renderCurrencyField({ selected: 'USD' });

    expect(utils.getByText('US Dollar')).toBeTruthy();
    expect(utils.queryByText('USD — US Dollar')).toBeNull();
  });

  it('does not show the ISO code in the visible row label', async () => {
    const utils = await renderCurrencyField();
    await open(utils);
    await search(utils, 'USD');

    // The visible row text is just the localized name…
    expect(utils.getByText('US Dollar')).toBeTruthy();
    // …never the old "USD — US Dollar"/bare "USD" combined row label. (The
    // accessibility label still carries the code — asserted separately above
    // via `currency-option-USD` — so this only proves the ISO code is gone
    // from the visible, on-screen text.)
    expect(utils.queryByText('USD — US Dollar')).toBeNull();
    expect(utils.queryByText('USD')).toBeNull();
  });
});
